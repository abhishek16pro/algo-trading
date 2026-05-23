import { BrokerAccountModel, OrderModel } from '@algo/db';
import { type RedisPubSub } from '@algo/redis-client';
import { channels, type NormalizedOrder } from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import type { AdapterRegistry } from './adapter-registry.js';

/**
 * Every 10s, pulls each connected broker's order book and merges deltas into our `orders`
 * collection. Also subscribes to broker WS `order` events for low-latency updates.
 *
 * Idempotency: only updates orders whose `brokerOrderId` is known.
 */
export class Reconciler {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly log: Logger,
    private readonly pubsub: RedisPubSub,
    private readonly registry: AdapterRegistry,
  ) {}

  async start(): Promise<void> {
    this.timer = setInterval(() => void this.tick(), 10_000);
    void this.tick();
    this.log.info('reconciler started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const accounts = await BrokerAccountModel.find({ isActive: true, deletedAt: { $exists: false } }).lean();
    for (const acc of accounts) {
      try {
        const adapter = await this.registry.for(String(acc._id));
        const remote = await adapter.getOrderBook();
        await this.merge(String(acc._id), remote);
      } catch (err) {
        this.log.debug({ err, accId: String(acc._id) }, 'reconciler skipped account');
      }
    }
  }

  private async merge(brokerAccountId: string, remote: NormalizedOrder[]): Promise<void> {
    if (remote.length === 0) return;
    const byBrokerId = new Map(remote.map((r) => [r.brokerOrderId, r]));
    const local = await OrderModel.find({
      brokerAccountId,
      brokerOrderId: { $in: Array.from(byBrokerId.keys()) },
    });
    for (const o of local) {
      const r = byBrokerId.get(o.brokerOrderId!)!;
      let changed = false;
      if (o.status !== r.status) {
        o.status = r.status;
        o.statusHistory!.push({ status: r.status, at: r.updatedAt ?? new Date() });
        changed = true;
      }
      if (o.filledQty !== r.filledQty) {
        o.filledQty = r.filledQty;
        o.pendingQty = o.quantity - r.filledQty;
        changed = true;
      }
      if (o.averagePrice !== r.averagePrice) {
        o.averagePrice = r.averagePrice;
        changed = true;
      }
      if (changed) {
        if (r.status === 'COMPLETE' && !o.filledAt) o.filledAt = r.filledAt ?? new Date();
        await o.save();
        await this.pubsub.publish(channels.orderUpdates(String(o.userId)), {
          type: 'order:update',
          orderId: String(o._id),
          order: o.toObject(),
        });
      }
    }
  }
}
