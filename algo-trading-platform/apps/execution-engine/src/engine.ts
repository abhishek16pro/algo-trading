import type { Redis } from 'ioredis';
import { OrderModel, type OrderDoc } from '@algo/db';
import { type RedisPubSub } from '@algo/redis-client';
import { channels, type BrokerId, type NormalizedOrderRequest } from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import { OrderRouter, type OrderContext } from './order-router.js';
import { RiskGate } from './risk-gate.js';
import { PaperSimulator } from './paper-simulator.js';
import { Reconciler } from './reconciler.js';
import { BracketManager } from './bracket-manager.js';
import type { AdapterRegistry } from './adapter-registry.js';

export type ExecutionDeps = {
  log: Logger;
  redis: Redis;
  pubsub: RedisPubSub;
  registry: AdapterRegistry;
  defaultBroker: BrokerId;
};

export class ExecutionEngine {
  private router: OrderRouter;
  private paper: PaperSimulator;
  private bracket: BracketManager;
  private reconciler: Reconciler;
  private stopped = false;

  constructor(private readonly deps: ExecutionDeps) {
    this.paper = new PaperSimulator(deps.log, deps.redis, deps.pubsub);
    const risk = new RiskGate(deps.log, deps.redis, deps.registry);
    this.router = new OrderRouter(deps.log, deps.pubsub, deps.registry, risk, this.paper);
    this.bracket = new BracketManager(deps.log, deps.pubsub, this.router);
    this.reconciler = new Reconciler(deps.log, deps.pubsub, deps.registry);
  }

  async start(): Promise<void> {
    await this.paper.start();
    await this.bracket.start();
    await this.reconciler.start();
    this.deps.log.info('execution-engine started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.reconciler.stop();
    await this.paper.stop();
  }

  /** Public placement API — invoked by API gateway or strategy-engine via IPC/queue. */
  async place(req: NormalizedOrderRequest, ctx: OrderContext): Promise<OrderDoc> {
    if (this.stopped) throw new Error('execution-engine stopped');
    const order = await this.router.place(req, ctx);
    await this.deps.pubsub.publish(channels.orderUpdates(ctx.userId), {
      type: 'order:update',
      order: order.toObject ? order.toObject() : order,
    });
    return order;
  }

  async cancel(orderId: string, ctx: OrderContext): Promise<void> {
    await this.router.cancel(orderId, ctx);
    await this.deps.pubsub.publish(channels.orderUpdates(ctx.userId), {
      type: 'order:cancelled',
      orderId,
    });
  }

  async modify(
    orderId: string,
    patch: Partial<NormalizedOrderRequest>,
    ctx: OrderContext,
  ): Promise<void> {
    await this.router.modify(orderId, patch, ctx);
  }
}
