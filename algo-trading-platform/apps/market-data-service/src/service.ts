import type { Redis } from 'ioredis';
import {
  createAdapter,
  type IBrokerAdapter,
} from '@algo/broker-adapters';
import { RedisKeys, type RedisPubSub } from '@algo/redis-client';
import {
  channels,
  type BrokerCredentials,
  type BrokerId,
  type SubscriptionRequest,
  type Tick,
} from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import { CandleAggregator } from './candle-aggregator.js';

export type AttachOptions = {
  brokerAccountId: string;
  broker: BrokerId;
  credentials: BrokerCredentials;
};

type Connection = {
  brokerAccountId: string;
  broker: BrokerId;
  adapter: IBrokerAdapter;
  /** tokens currently subscribed via this connection */
  subscribed: Set<string>;
  reconnectAttempts: number;
};

/**
 * The single place that talks to broker WebSockets. Every tick is normalized, written to
 * `tick:last:{token}` and published on `ticks.{token}`. Subscriptions are reference-counted so
 * a token is only unsubscribed from the broker when no service still wants it.
 */
export class MarketDataService {
  private connections = new Map<string, Connection>();
  private aggregator: CandleAggregator;
  private stopping = false;

  constructor(
    private readonly deps: {
      log: Logger;
      redis: Redis;
      pubsub: RedisPubSub;
      defaultBroker: BrokerId;
    },
  ) {
    this.aggregator = new CandleAggregator(deps.redis, deps.pubsub, deps.log);
  }

  async start(): Promise<void> {
    await this.deps.pubsub.subscribe<SubscriptionRequest>(
      channels.subscriptionRequest,
      (req) => this.handleSubscriptionRequest(req),
    );
    this.deps.log.info({ connections: this.connections.size }, 'market-data started');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const conn of this.connections.values()) {
      try {
        await conn.adapter.disconnectWS();
      } catch (err) {
        this.deps.log.warn({ err, broker: conn.broker }, 'disconnect error during shutdown');
      }
    }
  }

  async attachBroker(opts: AttachOptions): Promise<void> {
    if (this.connections.has(opts.brokerAccountId)) return;

    const adapter = createAdapter(opts.broker, {
      brokerAccountId: opts.brokerAccountId,
      credentials: opts.credentials,
    });

    const conn: Connection = {
      brokerAccountId: opts.brokerAccountId,
      broker: opts.broker,
      adapter,
      subscribed: new Set(),
      reconnectAttempts: 0,
    };

    adapter.on('tick', (t) => void this.onTick(t));
    adapter.on('disconnect', (reason) => void this.onDisconnect(conn, reason));
    adapter.on('error', (err) => this.deps.log.error({ err, broker: opts.broker }, 'broker error'));

    try {
      await adapter.connectWS();
      conn.reconnectAttempts = 0;
      this.connections.set(opts.brokerAccountId, conn);
      this.deps.log.info({ broker: opts.broker, brokerAccountId: opts.brokerAccountId }, 'broker attached');

      // Restore: if any subs exist in subs:global, re-subscribe via this connection.
      const tokens = await this.deps.redis.smembers(RedisKeys.subsGlobal());
      if (tokens.length > 0) {
        await adapter.subscribe(tokens, 'quote');
        for (const t of tokens) conn.subscribed.add(t);
        this.deps.log.info({ count: tokens.length }, 'restored subscriptions for new broker');
      }

      await this.deps.pubsub.publish(channels.brokerEvents(opts.brokerAccountId), {
        kind: 'connected',
        brokerAccountId: opts.brokerAccountId,
      });
    } catch (err) {
      this.deps.log.error({ err, broker: opts.broker }, 'failed to attach broker');
      throw err;
    }
  }

  private async handleSubscriptionRequest(req: SubscriptionRequest): Promise<void> {
    if (this.stopping) return;
    if (req.action === 'subscribe') await this.subscribeTokens(req.tokens, req.mode ?? 'quote');
    else await this.unsubscribeTokens(req.tokens);
  }

  private async subscribeTokens(tokens: string[], mode: 'ltp' | 'quote' | 'full'): Promise<void> {
    const newlyNeeded: string[] = [];
    for (const t of tokens) {
      const after = await this.deps.redis.incr(RedisKeys.subRefcount(t));
      if (after === 1) {
        await this.deps.redis.sadd(RedisKeys.subsGlobal(), t);
        newlyNeeded.push(t);
      }
    }
    if (newlyNeeded.length === 0) return;

    for (const conn of this.connections.values()) {
      try {
        await conn.adapter.subscribe(newlyNeeded, mode);
        for (const t of newlyNeeded) conn.subscribed.add(t);
      } catch (err) {
        this.deps.log.warn({ err, broker: conn.broker }, 'subscribe failed');
      }
    }
    this.deps.log.debug({ tokens: newlyNeeded.length }, 'new subscriptions established');
  }

  private async unsubscribeTokens(tokens: string[]): Promise<void> {
    const toDrop: string[] = [];
    for (const t of tokens) {
      const after = await this.deps.redis.decr(RedisKeys.subRefcount(t));
      if (after <= 0) {
        await this.deps.redis.del(RedisKeys.subRefcount(t));
        await this.deps.redis.srem(RedisKeys.subsGlobal(), t);
        toDrop.push(t);
      }
    }
    if (toDrop.length === 0) return;

    for (const conn of this.connections.values()) {
      try {
        await conn.adapter.unsubscribe(toDrop);
        for (const t of toDrop) conn.subscribed.delete(t);
      } catch (err) {
        this.deps.log.warn({ err, broker: conn.broker }, 'unsubscribe failed');
      }
    }
  }

  private async onTick(tick: Tick): Promise<void> {
    // 1. Hot-path: write LTP to Redis
    const key = RedisKeys.tickLast(tick.instrumentToken);
    const p = this.deps.redis.pipeline();
    p.hset(key, {
      ltp: tick.ltp.toString(),
      ts: tick.ltt.getTime().toString(),
      vol: tick.volume.toString(),
      oi: (tick.oi ?? 0).toString(),
      bid: (tick.bid ?? 0).toString(),
      ask: (tick.ask ?? 0).toString(),
    });
    p.expire(key, 60 * 60 * 24);
    await p.exec();

    // 2. Publish to subscribers (strategy/signal services and gateway)
    await this.deps.pubsub.publish(channels.tick(tick.instrumentToken), tick);

    // 3. Roll the in-memory candles forward
    this.aggregator.onTick(tick).catch((err) =>
      this.deps.log.error({ err }, 'candle aggregator failed'),
    );
  }

  private async onDisconnect(conn: Connection, reason?: string): Promise<void> {
    if (this.stopping) return;
    conn.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(conn.reconnectAttempts, 5));
    this.deps.log.warn(
      { broker: conn.broker, reason, attempt: conn.reconnectAttempts, delay },
      'broker WS disconnected — scheduling reconnect',
    );
    await this.deps.pubsub.publish(channels.brokerEvents(conn.brokerAccountId), {
      kind: 'disconnected',
      brokerAccountId: conn.brokerAccountId,
      reason,
    });
    setTimeout(() => void this.reconnect(conn), delay);
  }

  private async reconnect(conn: Connection): Promise<void> {
    if (this.stopping) return;
    try {
      await conn.adapter.connectWS();
      const tokens = await this.deps.redis.smembers(RedisKeys.subsGlobal());
      if (tokens.length > 0) await conn.adapter.subscribe(tokens, 'quote');
      conn.reconnectAttempts = 0;
      this.deps.log.info({ broker: conn.broker }, 'broker WS reconnected');
      await this.deps.pubsub.publish(channels.brokerEvents(conn.brokerAccountId), {
        kind: 'reconnected',
        brokerAccountId: conn.brokerAccountId,
      });
    } catch (err) {
      this.deps.log.error({ err, broker: conn.broker }, 'reconnect failed — backing off');
      void this.onDisconnect(conn, 'reconnect-failed');
    }
  }
}
