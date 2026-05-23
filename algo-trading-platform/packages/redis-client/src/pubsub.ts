import type { Redis } from 'ioredis';
import type { Logger } from '@algo/utils';

/**
 * Lightweight pub/sub helper. The redis subscriber connection MUST be separate from the main
 * command connection; pass one in or use `createRedis(uri)` twice.
 */
export class RedisPubSub {
  private handlers = new Map<string, Set<(payload: unknown) => void | Promise<void>>>();
  private patternHandlers = new Map<string, Set<(channel: string, payload: unknown) => void | Promise<void>>>();

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
    private readonly log?: Logger,
  ) {
    this.sub.on('message', (channel, raw) => this.dispatch(channel, raw));
    this.sub.on('pmessage', (pattern, channel, raw) => this.dispatchPattern(pattern, channel, raw));
  }

  async publish<T>(channel: string, payload: T): Promise<number> {
    return this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe<T>(channel: string, handler: (payload: T) => void | Promise<void>): Promise<void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(handler as (payload: unknown) => void | Promise<void>);
  }

  async unsubscribe(channel: string, handler?: (payload: unknown) => void): Promise<void> {
    const set = this.handlers.get(channel);
    if (!set) return;
    if (handler) set.delete(handler);
    if (!handler || set.size === 0) {
      this.handlers.delete(channel);
      await this.sub.unsubscribe(channel);
    }
  }

  async psubscribe<T>(
    pattern: string,
    handler: (channel: string, payload: T) => void | Promise<void>,
  ): Promise<void> {
    let set = this.patternHandlers.get(pattern);
    if (!set) {
      set = new Set();
      this.patternHandlers.set(pattern, set);
      await this.sub.psubscribe(pattern);
    }
    set.add(handler as (channel: string, payload: unknown) => void | Promise<void>);
  }

  private dispatch(channel: string, raw: string): void {
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      this.log?.warn({ err, channel }, 'pubsub bad json');
      return;
    }
    for (const h of set) {
      Promise.resolve()
        .then(() => h(payload))
        .catch((err) => this.log?.error({ err, channel }, 'pubsub handler threw'));
    }
  }

  private dispatchPattern(pattern: string, channel: string, raw: string): void {
    const set = this.patternHandlers.get(pattern);
    if (!set || set.size === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      this.log?.warn({ err, pattern, channel }, 'pubsub bad json (pattern)');
      return;
    }
    for (const h of set) {
      Promise.resolve()
        .then(() => h(channel, payload))
        .catch((err) =>
          this.log?.error({ err, pattern, channel }, 'pubsub pattern handler threw'),
        );
    }
  }
}
