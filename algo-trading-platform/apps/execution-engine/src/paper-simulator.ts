import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { OrderModel, type OrderDoc, PositionModel } from '@algo/db';
import { RedisKeys, type RedisPubSub } from '@algo/redis-client';
import {
  channels,
  type NormalizedOrderRequest,
  type Tick,
} from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import { simulateBrokerage } from './brokerage.js';

/**
 * Simulates broker fill behavior for `mode: 'paper'` orders.
 *
 *   - MARKET orders fill immediately at LTP plus 1-tick adverse slippage.
 *   - LIMIT orders rest in an in-memory book keyed by token; fill on next tick that crosses.
 *   - SL / SL-M trigger on the next tick that crosses triggerPrice.
 *
 * Emits the same `orders.{userId}` events as live orders so the UI cannot tell them apart.
 */
export class PaperSimulator {
  private resting = new Map<string, Set<string>>(); // token -> set of orderId
  private ordersById = new Map<string, OrderDoc>();
  private subscribed = false;

  constructor(
    private readonly log: Logger,
    private readonly redis: Redis,
    private readonly pubsub: RedisPubSub,
  ) {}

  async start(): Promise<void> {
    if (this.subscribed) return;
    // Recover any in-flight paper orders on restart.
    const inflight = await OrderModel.find({
      mode: 'paper',
      status: { $in: ['QUEUED', 'OPEN', 'PARTIAL', 'PENDING'] },
    });
    for (const o of inflight) this.indexResting(o);
    this.log.info({ resting: inflight.length }, 'paper simulator booted');

    await this.pubsub.psubscribe<Tick>('ticks.*', (_chan, tick) => {
      void this.onTick(tick);
    });
    this.subscribed = true;
  }

  async stop(): Promise<void> {
    this.resting.clear();
    this.ordersById.clear();
  }

  async submit(order: OrderDoc): Promise<void> {
    if (order.orderType === 'MARKET') {
      const ltpRaw = await this.redis.hget(RedisKeys.tickLast(order.instrumentToken), 'ltp');
      const ltp = ltpRaw ? Number(ltpRaw) : order.price || 100;
      const slip = 0.05 * (order.side === 'BUY' ? 1 : -1);
      await this.fill(order, ltp + slip);
    } else {
      order.status = 'OPEN';
      order.statusHistory!.push({ status: 'OPEN', at: new Date() });
      await order.save();
      this.indexResting(order);
      await this.pubsub.publish(channels.orderUpdates(String(order.userId)), {
        type: 'order:open',
        orderId: String(order._id),
        order: order.toObject(),
      });
    }
  }

  async cancel(order: OrderDoc): Promise<void> {
    this.removeResting(order);
  }

  async modify(order: OrderDoc, patch: Partial<NormalizedOrderRequest>): Promise<void> {
    // Re-index in case price/trigger changed
    this.removeResting(order);
    if (patch.price !== undefined) order.price = patch.price;
    if (patch.triggerPrice !== undefined) order.triggerPrice = patch.triggerPrice;
    this.indexResting(order);
  }

  private indexResting(order: OrderDoc): void {
    const set = this.resting.get(order.instrumentToken) ?? new Set();
    set.add(String(order._id));
    this.resting.set(order.instrumentToken, set);
    this.ordersById.set(String(order._id), order);
  }

  private removeResting(order: OrderDoc): void {
    const set = this.resting.get(order.instrumentToken);
    if (set) set.delete(String(order._id));
    this.ordersById.delete(String(order._id));
  }

  private async onTick(tick: Tick): Promise<void> {
    const set = this.resting.get(tick.instrumentToken);
    if (!set || set.size === 0) return;

    for (const orderId of set) {
      const order = this.ordersById.get(orderId);
      if (!order) continue;
      if (order.status === 'COMPLETE' || order.status === 'CANCELLED' || order.status === 'REJECTED') {
        set.delete(orderId);
        this.ordersById.delete(orderId);
        continue;
      }
      if (order.orderType === 'LIMIT') {
        if (
          (order.side === 'BUY' && tick.ltp <= order.price!) ||
          (order.side === 'SELL' && tick.ltp >= order.price!)
        ) {
          await this.fill(order, tick.ltp);
        }
      } else if (order.orderType === 'SL' || order.orderType === 'SL-M') {
        const triggered =
          (order.side === 'BUY' && tick.ltp >= (order.triggerPrice ?? Infinity)) ||
          (order.side === 'SELL' && tick.ltp <= (order.triggerPrice ?? -Infinity));
        if (!triggered) continue;
        if (order.orderType === 'SL-M') {
          await this.fill(order, tick.ltp);
        } else if (
          (order.side === 'BUY' && tick.ltp <= order.price!) ||
          (order.side === 'SELL' && tick.ltp >= order.price!)
        ) {
          await this.fill(order, tick.ltp);
        }
      }
    }
  }

  private async fill(order: OrderDoc, fillPrice: number): Promise<void> {
    order.filledQty = order.quantity;
    order.pendingQty = 0;
    order.averagePrice = fillPrice;
    order.status = 'COMPLETE';
    order.filledAt = new Date();
    order.statusHistory!.push({ status: 'COMPLETE', at: order.filledAt });
    await order.save();
    this.removeResting(order);

    // Update position
    const brokerage = simulateBrokerage(order.exchange, order.quantity, fillPrice, order.side);
    await this.upsertPosition(order, fillPrice, brokerage);

    await this.pubsub.publish(channels.orderUpdates(String(order.userId)), {
      type: 'order:filled',
      orderId: String(order._id),
      brokerage,
      order: order.toObject(),
    });
  }

  private async upsertPosition(order: OrderDoc, fillPrice: number, brokerage: number): Promise<void> {
    const signedQty = order.side === 'BUY' ? order.quantity : -order.quantity;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const existing = await PositionModel.findOne({
          userId: order.userId,
          brokerAccountId: order.brokerAccountId,
          mode: order.mode,
          instrumentToken: order.instrumentToken,
          product: order.product,
        }).session(session);

        if (!existing) {
          await PositionModel.create(
            [
              {
                userId: order.userId,
                strategyId: order.strategyId,
                brokerAccountId: order.brokerAccountId,
                mode: order.mode,
                tradingsymbol: order.tradingsymbol,
                exchange: order.exchange,
                instrumentToken: order.instrumentToken,
                product: order.product,
                netQty: signedQty,
                buyQty: order.side === 'BUY' ? order.quantity : 0,
                sellQty: order.side === 'SELL' ? order.quantity : 0,
                avgPrice: fillPrice,
                lastPrice: fillPrice,
                realizedPnl: -brokerage,
                unrealizedPnl: 0,
                pnl: -brokerage,
                mtm: -brokerage,
                legs: [{ orderId: order._id, qty: order.quantity, price: fillPrice, side: order.side }],
              },
            ],
            { session },
          );
        } else {
          const newNet = existing.netQty! + signedQty;
          let avg = existing.avgPrice!;
          let realized = existing.realizedPnl!;

          if (Math.sign(existing.netQty!) === Math.sign(signedQty) || existing.netQty === 0) {
            avg =
              (existing.avgPrice! * Math.abs(existing.netQty!) +
                fillPrice * Math.abs(signedQty)) /
              Math.max(1, Math.abs(newNet));
          } else {
            const closingQty = Math.min(Math.abs(existing.netQty!), Math.abs(signedQty));
            const dir = existing.netQty! > 0 ? 1 : -1;
            realized += (fillPrice - existing.avgPrice!) * closingQty * dir;
            if (Math.abs(signedQty) > Math.abs(existing.netQty!)) avg = fillPrice;
          }
          existing.netQty = newNet;
          existing.buyQty = (existing.buyQty ?? 0) + Math.max(0, signedQty);
          existing.sellQty = (existing.sellQty ?? 0) + Math.max(0, -signedQty);
          existing.avgPrice = avg;
          existing.lastPrice = fillPrice;
          existing.realizedPnl = realized - brokerage;
          existing.unrealizedPnl = (fillPrice - avg) * newNet;
          existing.pnl = existing.realizedPnl + existing.unrealizedPnl;
          existing.mtm = existing.pnl;
          existing.legs!.push({
            orderId: order._id,
            qty: order.quantity,
            price: fillPrice,
            side: order.side,
            ts: new Date(),
          });
          if (newNet === 0) existing.closedAt = new Date();
          await existing.save({ session });
        }
      });
    } finally {
      await session.endSession();
    }

    await this.pubsub.publish(channels.positionUpdates(String(order.userId)), {
      type: 'position:update',
      instrumentToken: order.instrumentToken,
    });
  }
}
