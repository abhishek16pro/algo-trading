import type { Redis } from 'ioredis';
import { StrategyModel, type StrategyDoc } from '@algo/db';
import { RedisKeys, type RedisPubSub } from '@algo/redis-client';
import { channels, type StrategyStateEvent } from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import { StrategyRuntime } from './strategy-runtime.js';

/**
 * Loads every strategy with mode in {live, paper} and a running state, and instantiates a
 * StrategyRuntime per strategy. Also reacts to `strategy:state` events so the UI can
 * deploy/pause/stop without restarting the service.
 */
export class Supervisor {
  private runtimes = new Map<string, StrategyRuntime>();
  private stopped = false;

  constructor(
    private readonly deps: {
      log: Logger;
      redis: Redis;
      pubsub: RedisPubSub;
    },
  ) {}

  async start(): Promise<void> {
    const docs = await StrategyModel.find({
      mode: { $in: ['live', 'paper'] },
      state: 'running',
      deletedAt: { $exists: false },
    }).lean<StrategyDoc[]>();
    for (const d of docs) await this.spawn(d);

    await this.deps.pubsub.psubscribe<StrategyStateEvent>(
      'strategy.state.*',
      (_chan, payload) => void this.onStateEvent(payload),
    );
    this.deps.log.info({ count: this.runtimes.size }, 'supervisor started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const rt of this.runtimes.values()) await rt.stop();
    this.runtimes.clear();
  }

  async spawn(doc: StrategyDoc): Promise<void> {
    const id = String(doc._id);
    if (this.runtimes.has(id)) return;
    const rt = new StrategyRuntime(doc, {
      log: this.deps.log.child({ strategyId: id }),
      redis: this.deps.redis,
      pubsub: this.deps.pubsub,
    });
    await rt.start();
    this.runtimes.set(id, rt);
    await this.deps.redis.hset(RedisKeys.strategyState(id), { state: 'running' });
  }

  async pause(strategyId: string): Promise<void> {
    const rt = this.runtimes.get(strategyId);
    if (!rt) return;
    await rt.pause();
    await this.deps.redis.hset(RedisKeys.strategyState(strategyId), { state: 'paused' });
  }

  async kill(strategyId: string): Promise<void> {
    const rt = this.runtimes.get(strategyId);
    if (!rt) return;
    await rt.stop();
    this.runtimes.delete(strategyId);
    await this.deps.redis.hset(RedisKeys.strategyState(strategyId), { state: 'idle' });
  }

  private async onStateEvent(event: StrategyStateEvent): Promise<void> {
    if (this.stopped) return;
    if (event.state === 'running') {
      const doc = await StrategyModel.findById(event.strategyId).lean<StrategyDoc>();
      if (doc) await this.spawn(doc);
    } else if (event.state === 'paused') {
      await this.pause(event.strategyId);
    } else if (event.state === 'idle') {
      await this.kill(event.strategyId);
    }
  }
}
