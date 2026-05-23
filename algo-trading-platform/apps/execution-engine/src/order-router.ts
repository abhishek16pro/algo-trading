import mongoose from 'mongoose';
import { OrderModel, type OrderDoc } from '@algo/db';
import { type RedisPubSub } from '@algo/redis-client';
import {
  channels,
  type NormalizedOrderRequest,
  type OrderMode,
} from '@algo/shared-types';
import { AppError, RiskGateError, sha256Hex, type Logger } from '@algo/utils';
import type { AdapterRegistry } from './adapter-registry.js';
import type { PaperSimulator } from './paper-simulator.js';
import type { RiskGate } from './risk-gate.js';

export type OrderContext = {
  userId: string;
  brokerAccountId: string;
  mode: OrderMode;
  strategyId?: string;
  /** Optional override; if omitted, derived from strategyId/leg/timestamp. */
  idempotencyKey?: string;
  parentOrderId?: string;
};

export class OrderRouter {
  constructor(
    private readonly log: Logger,
    private readonly pubsub: RedisPubSub,
    private readonly registry: AdapterRegistry,
    private readonly risk: RiskGate,
    private readonly paper: PaperSimulator,
  ) {}

  async place(req: NormalizedOrderRequest, ctx: OrderContext): Promise<OrderDoc> {
    // 1. Idempotency check — fast path: if an order with the same idempotency key exists, return it.
    const idemKey = ctx.idempotencyKey ?? this.deriveIdemKey(req, ctx);
    if (idemKey) {
      const existing = await OrderModel.findOne({ idempotencyKey: idemKey }).exec();
      if (existing) {
        this.log.info({ idemKey, orderId: existing._id }, 'idempotent replay');
        return existing;
      }
    }

    // 2. Persist a DRAFT
    const order = await OrderModel.create({
      userId: ctx.userId,
      strategyId: ctx.strategyId,
      brokerAccountId: ctx.brokerAccountId,
      mode: ctx.mode,
      tradingsymbol: req.tradingsymbol,
      exchange: req.exchange,
      // instrumentToken is set later from contract master if needed — for now we use the symbol.
      instrumentToken: (req as { instrumentToken?: string }).instrumentToken ?? req.tradingsymbol,
      side: req.side,
      orderType: req.orderType,
      product: req.product,
      validity: req.validity ?? 'DAY',
      quantity: req.quantity,
      pendingQty: req.quantity,
      price: req.price ?? 0,
      triggerPrice: req.triggerPrice,
      status: 'DRAFT',
      tag: req.tag,
      parentOrderId: ctx.parentOrderId,
      idempotencyKey: idemKey,
      statusHistory: [{ status: 'DRAFT', at: new Date() }],
    });

    // 3. Risk gate
    try {
      await this.risk.check(req, ctx);
    } catch (err) {
      if (err instanceof RiskGateError) {
        order.status = 'REJECTED';
        order.statusMessage = err.message;
        order.statusHistory!.push({ status: 'REJECTED', at: new Date(), message: err.reason });
        await order.save();
        return order;
      }
      throw err;
    }

    // 4. Transition to QUEUED
    order.status = 'QUEUED';
    order.statusHistory!.push({ status: 'QUEUED', at: new Date() });
    await order.save();

    // 5. Dispatch
    if (ctx.mode === 'paper') {
      await this.paper.submit(order);
    } else {
      const adapter = await this.registry.for(ctx.brokerAccountId);
      try {
        const { brokerOrderId } = await adapter.placeOrder(req);
        order.brokerOrderId = brokerOrderId;
        order.status = 'SENT';
        order.statusHistory!.push({ status: 'SENT', at: new Date() });
        await order.save();
      } catch (err) {
        order.status = 'REJECTED';
        order.statusMessage = err instanceof Error ? err.message : String(err);
        order.statusHistory!.push({
          status: 'REJECTED',
          at: new Date(),
          message: order.statusMessage,
        });
        await order.save();
        throw err;
      }
    }

    await this.pubsub.publish(channels.orderUpdates(ctx.userId), {
      type: 'order:placed',
      orderId: String(order._id),
      order: order.toObject(),
    });
    return order;
  }

  async cancel(orderId: string, ctx: OrderContext): Promise<void> {
    const order = await OrderModel.findById(orderId).exec();
    if (!order) throw new AppError(`Order ${orderId} not found`, 404, 'NOT_FOUND');
    if (String(order.userId) !== ctx.userId) {
      throw new AppError('forbidden', 403, 'FORBIDDEN');
    }
    if (order.status === 'COMPLETE' || order.status === 'CANCELLED' || order.status === 'REJECTED') {
      return;
    }

    if (order.mode === 'paper') {
      await this.paper.cancel(order);
    } else {
      if (!order.brokerOrderId) throw new AppError('order not yet sent', 409, 'CONFLICT');
      const adapter = await this.registry.for(String(order.brokerAccountId));
      await adapter.cancelOrder(order.brokerOrderId);
    }
    order.status = 'CANCELLED';
    order.statusHistory!.push({ status: 'CANCELLED', at: new Date() });
    await order.save();
  }

  async modify(
    orderId: string,
    patch: Partial<NormalizedOrderRequest>,
    ctx: OrderContext,
  ): Promise<void> {
    const order = await OrderModel.findById(orderId).exec();
    if (!order) throw new AppError(`Order ${orderId} not found`, 404, 'NOT_FOUND');
    if (String(order.userId) !== ctx.userId) throw new AppError('forbidden', 403, 'FORBIDDEN');
    if (order.status === 'COMPLETE' || order.status === 'CANCELLED' || order.status === 'REJECTED') {
      throw new AppError(`cannot modify ${order.status} order`, 409, 'CONFLICT');
    }

    if (order.mode === 'paper') {
      await this.paper.modify(order, patch);
    } else {
      if (!order.brokerOrderId) throw new AppError('order not yet sent', 409, 'CONFLICT');
      const adapter = await this.registry.for(String(order.brokerAccountId));
      await adapter.modifyOrder(order.brokerOrderId, patch);
    }
    if (patch.price !== undefined) order.price = patch.price;
    if (patch.triggerPrice !== undefined) order.triggerPrice = patch.triggerPrice;
    if (patch.quantity !== undefined) {
      order.quantity = patch.quantity;
      order.pendingQty = patch.quantity - order.filledQty!;
    }
    await order.save();
  }

  private deriveIdemKey(req: NormalizedOrderRequest, ctx: OrderContext): string | undefined {
    if (!ctx.strategyId) return undefined;
    return sha256Hex(`${ctx.strategyId}|${req.tradingsymbol}|${req.side}|${req.quantity}|${req.tag ?? ''}|${Math.floor(Date.now() / 60_000)}`);
  }
}
