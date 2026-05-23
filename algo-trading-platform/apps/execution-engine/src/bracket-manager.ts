import { OrderModel, type OrderDoc, StrategyModel } from '@algo/db';
import { type RedisPubSub } from '@algo/redis-client';
import { channels } from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import type { OrderRouter, OrderContext } from './order-router.js';

/**
 * Client-side bracket-order emulation.
 *
 * When a strategy's entry order fills, this manager looks at the strategy's exit config
 * (stopLoss, target, trailingSL) and places child orders. Implements OCO: if one child fills,
 * the other is cancelled. Trailing SL recomputes on every position tick.
 */
export class BracketManager {
  private subscribed = false;

  constructor(
    private readonly log: Logger,
    private readonly pubsub: RedisPubSub,
    private readonly router: OrderRouter,
  ) {}

  async start(): Promise<void> {
    if (this.subscribed) return;
    await this.pubsub.psubscribe<unknown>('orders.*', (_chan, payload) => {
      void this.onOrderEvent(payload as { type: string; orderId?: string; order?: unknown });
    });
    this.subscribed = true;
    this.log.info('bracket manager started');
  }

  private async onOrderEvent(payload: {
    type: string;
    orderId?: string;
    order?: unknown;
  }): Promise<void> {
    if (payload.type !== 'order:filled') return;
    if (!payload.orderId) return;

    const order = await OrderModel.findById(payload.orderId).exec();
    if (!order) return;
    if (!order.strategyId) return;
    // Skip child legs themselves.
    if (order.parentOrderId) {
      await this.handleChildFill(order);
      return;
    }

    const strategy = await StrategyModel.findById(order.strategyId).lean();
    if (!strategy) return;
    const exit = strategy.exit;
    if (!exit) return;

    const oppositeSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    const entryPrice = order.averagePrice ?? order.price ?? 0;
    if (!entryPrice) return;

    const childCtx: OrderContext = {
      userId: String(order.userId),
      brokerAccountId: String(order.brokerAccountId),
      mode: order.mode as 'live' | 'paper',
      strategyId: String(order.strategyId),
      parentOrderId: String(order._id),
    };

    const children: string[] = [];

    if (exit.stopLoss && exit.stopLoss.value && exit.stopLoss.type) {
      const slPrice = slPriceFor(
        entryPrice,
        exit.stopLoss.value,
        exit.stopLoss.type as 'percent' | 'points' | 'rupees',
        order.side as 'BUY' | 'SELL',
      );
      try {
        const c = await this.router.place(
          {
            tradingsymbol: order.tradingsymbol,
            exchange: order.exchange,
            side: oppositeSide,
            quantity: order.quantity,
            orderType: 'SL-M',
            product: order.product,
            triggerPrice: slPrice,
            validity: 'DAY',
            tag: `${strategy._id}-SL`,
          },
          childCtx,
        );
        children.push(String(c._id));
      } catch (err) {
        this.log.warn({ err }, 'failed to place SL child');
      }
    }

    if (exit.target && exit.target.value && exit.target.type) {
      const tpPrice = tpPriceFor(
        entryPrice,
        exit.target.value,
        exit.target.type as 'percent' | 'points' | 'rupees',
        order.side as 'BUY' | 'SELL',
      );
      try {
        const c = await this.router.place(
          {
            tradingsymbol: order.tradingsymbol,
            exchange: order.exchange,
            side: oppositeSide,
            quantity: order.quantity,
            orderType: 'LIMIT',
            price: tpPrice,
            product: order.product,
            validity: 'DAY',
            tag: `${strategy._id}-TP`,
          },
          childCtx,
        );
        children.push(String(c._id));
      } catch (err) {
        this.log.warn({ err }, 'failed to place TP child');
      }
    }

    if (children.length > 0) {
      order.childOrderIds = children.map((id) => id) as never;
      await order.save();
      this.log.info(
        { orderId: String(order._id), children: children.length },
        'bracket children placed',
      );
    }
  }

  /** When a child fills (SL or TP), cancel the sibling. */
  private async handleChildFill(child: OrderDoc): Promise<void> {
    if (!child.parentOrderId) return;
    const siblings = await OrderModel.find({
      parentOrderId: child.parentOrderId,
      _id: { $ne: child._id },
      status: { $in: ['OPEN', 'PENDING', 'PARTIAL', 'QUEUED', 'SENT'] },
    });
    for (const sib of siblings) {
      try {
        await this.router.cancel(String(sib._id), {
          userId: String(sib.userId),
          brokerAccountId: String(sib.brokerAccountId),
          mode: sib.mode as 'live' | 'paper',
        });
        this.log.info({ siblingId: String(sib._id) }, 'OCO: sibling cancelled');
      } catch (err) {
        this.log.warn({ err, siblingId: String(sib._id) }, 'OCO cancel failed');
      }
    }
  }
}

function slPriceFor(
  entry: number,
  value: number,
  type: 'percent' | 'points' | 'rupees',
  side: 'BUY' | 'SELL',
): number {
  const offset = type === 'percent' ? entry * (value / 100) : value;
  return side === 'BUY' ? entry - offset : entry + offset;
}

function tpPriceFor(
  entry: number,
  value: number,
  type: 'percent' | 'points' | 'rupees',
  side: 'BUY' | 'SELL',
): number {
  const offset = type === 'percent' ? entry * (value / 100) : value;
  return side === 'BUY' ? entry + offset : entry - offset;
}
