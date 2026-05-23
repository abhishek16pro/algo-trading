import type { Redis } from 'ioredis';
import { HistoricalCandleModel } from '@algo/db';
import { RedisKeys, type RedisPubSub } from '@algo/redis-client';
import {
  channels,
  TIMEFRAME_MINUTES,
  type Candle,
  type Tick,
  type Timeframe,
} from '@algo/shared-types';
import { floorToTimeframe, type Logger } from '@algo/utils';

const TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h'];

type Building = Candle & { meta: { instrumentToken: string; timeframe: Timeframe } };

/**
 * Rolls ticks into candles for each strategy-relevant timeframe.
 *
 * State is held in Redis (`tick:ohlc:{token}:{tf}`) so a service restart doesn't lose the
 * in-progress candle. Once a candle's window closes, it is persisted to `historicalCandles`
 * and published on `candles.{token}.{tf}`.
 */
export class CandleAggregator {
  private inflight = new Map<string, Building>(); // local cache to avoid Redis round-trip every tick
  private pending: Building[] = [];
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly redis: Redis,
    private readonly pubsub: RedisPubSub,
    private readonly log: Logger,
  ) {
    this.flushTimer = setInterval(() => void this.flushPending(), 2000);
  }

  async onTick(tick: Tick): Promise<void> {
    for (const tf of TIMEFRAMES) {
      const mins = TIMEFRAME_MINUTES[tf];
      const bucket = floorToTimeframe(tick.ltt, mins);
      const key = `${tick.instrumentToken}:${tf}`;
      const cur = this.inflight.get(key);

      if (!cur || cur.t.getTime() !== bucket.getTime()) {
        // Close previous bucket
        if (cur) await this.closeCandle(cur);
        const fresh: Building = {
          t: bucket,
          o: tick.ltp,
          h: tick.ltp,
          l: tick.ltp,
          c: tick.ltp,
          v: tick.volume ?? 0,
          oi: tick.oi,
          meta: { instrumentToken: tick.instrumentToken, timeframe: tf },
        };
        this.inflight.set(key, fresh);
      } else {
        if (tick.ltp > cur.h) cur.h = tick.ltp;
        if (tick.ltp < cur.l) cur.l = tick.ltp;
        cur.c = tick.ltp;
        cur.v += tick.volume ?? 0;
        if (tick.oi !== undefined) cur.oi = tick.oi;
      }

      const live = this.inflight.get(key)!;
      // Persist current building candle to Redis for crash recovery
      await this.redis.hset(RedisKeys.tickOhlc(tick.instrumentToken, tf), {
        t: live.t.getTime().toString(),
        o: live.o.toString(),
        h: live.h.toString(),
        l: live.l.toString(),
        c: live.c.toString(),
        v: live.v.toString(),
      });
    }
  }

  private async closeCandle(c: Building): Promise<void> {
    this.pending.push(c);
    await this.pubsub.publish(channels.candle(c.meta.instrumentToken, c.meta.timeframe), {
      t: c.t,
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v,
      oi: c.oi,
      instrumentToken: c.meta.instrumentToken,
      timeframe: c.meta.timeframe,
    });
  }

  private async flushPending(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    try {
      await HistoricalCandleModel.insertMany(
        batch.map((c) => ({
          instrumentToken: c.meta.instrumentToken,
          timeframe: c.meta.timeframe,
          t: c.t,
          o: c.o,
          h: c.h,
          l: c.l,
          c: c.c,
          v: c.v,
          oi: c.oi,
        })),
        { ordered: false },
      );
    } catch (err) {
      this.log.error({ err, batch: batch.length }, 'failed to persist candle batch');
    }
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
  }
}
