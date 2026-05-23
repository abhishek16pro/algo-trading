import type { RedisPubSub } from '@algo/redis-client';
import type { NormalizedOrderRequest } from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import type { ExecutionEngine } from './engine.js';

type PlaceMsg = {
  req: NormalizedOrderRequest;
  ctx: {
    userId: string;
    brokerAccountId: string;
    mode: 'live' | 'paper';
    strategyId?: string;
  };
};

type CancelMsg = {
  orderId: string;
  userId: string;
  brokerAccountId: string;
  mode: 'live' | 'paper';
};

/**
 * Subscribes to `exec:place` and `exec:cancel` Redis channels — the inter-service contract
 * strategy-engine uses to drive the execution engine. Avoids needing direct in-process imports.
 */
export class ExecListener {
  constructor(
    private readonly log: Logger,
    private readonly pubsub: RedisPubSub,
    private readonly engine: ExecutionEngine,
  ) {}

  async start(): Promise<void> {
    await this.pubsub.subscribe<PlaceMsg>('exec:place', (msg) => void this.onPlace(msg));
    await this.pubsub.subscribe<CancelMsg>('exec:cancel', (msg) => void this.onCancel(msg));
    this.log.info('exec-listener bound to exec:place / exec:cancel');
  }

  private async onPlace(msg: PlaceMsg): Promise<void> {
    try {
      await this.engine.place(msg.req, msg.ctx);
    } catch (err) {
      this.log.error({ err, strategyId: msg.ctx.strategyId }, 'place via channel failed');
    }
  }

  private async onCancel(msg: CancelMsg): Promise<void> {
    try {
      await this.engine.cancel(msg.orderId, {
        userId: msg.userId,
        brokerAccountId: msg.brokerAccountId,
        mode: msg.mode,
      });
    } catch (err) {
      this.log.error({ err, orderId: msg.orderId }, 'cancel via channel failed');
    }
  }
}
