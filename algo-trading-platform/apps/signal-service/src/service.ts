import { HistoricalCandleModel, SignalModel, type SignalDoc } from '@algo/db';
import {
  bollinger,
  crossesAbove,
  crossesBelow,
  ema,
  macd,
  rsi,
  sma,
  supertrend,
  vwap,
} from '@algo/indicators';
import type { RedisPubSub } from '@algo/redis-client';
import {
  channels,
  type Candle,
  type SignalCondition,
  type SignalEvent,
  type Timeframe,
} from '@algo/shared-types';
import type { Logger } from '@algo/utils';

/**
 * Watches candle close events for each registered signal, evaluates its condition, and emits a
 * `signals.{signalId}` event when the condition transitions from false to true.
 */
export class SignalService {
  private signals = new Map<string, SignalDoc>();
  private warmupBuffers = new Map<string, Candle[]>(); // key = `${token}:${tf}`
  /** key = signalId, value = previous truth-state (for edge-detection of crossover conditions). */
  private lastTruth = new Map<string, boolean>();
  private stopped = false;

  constructor(private readonly deps: { log: Logger; pubsub: RedisPubSub }) {}

  async start(): Promise<void> {
    await this.loadSignals();
    await this.deps.pubsub.psubscribe<Candle & { instrumentToken: string; timeframe: Timeframe }>(
      'candles.*',
      (channel, payload) => this.onCandle(channel, payload),
    );
    this.deps.log.info({ signals: this.signals.size }, 'signal-service started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async reload(): Promise<void> {
    await this.loadSignals();
  }

  private async loadSignals(): Promise<void> {
    const docs = await SignalModel.find({ deletedAt: { $exists: false } }).lean();
    this.signals.clear();
    for (const d of docs) this.signals.set(String(d._id), d as SignalDoc);
  }

  private async onCandle(
    channel: string,
    payload: Candle & { instrumentToken: string; timeframe: Timeframe },
  ): Promise<void> {
    if (this.stopped) return;
    const parts = channel.split('.');
    if (parts.length < 3) return;
    const token = parts[1]!;
    const tf = parts[2] as Timeframe;
    const key = `${token}:${tf}`;
    let buf = this.warmupBuffers.get(key);
    if (!buf) {
      buf = await this.warmupFromHistory(token, tf, 250);
      this.warmupBuffers.set(key, buf);
    }
    buf.push(payload);
    if (buf.length > 500) buf.shift();

    for (const sig of this.signals.values()) {
      if (sig.timeframe !== tf) continue;
      try {
        await this.evaluate(sig, token, buf);
      } catch (err) {
        this.deps.log.warn({ err, signalId: String(sig._id) }, 'signal eval failed');
      }
    }
  }

  private async warmupFromHistory(token: string, tf: Timeframe, n: number): Promise<Candle[]> {
    const rows = await HistoricalCandleModel.find({ instrumentToken: token, timeframe: tf })
      .sort({ t: -1 })
      .limit(n)
      .lean();
    return rows
      .reverse()
      .map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, oi: r.oi ?? undefined }));
  }

  private async evaluate(sig: SignalDoc, token: string, candles: Candle[]): Promise<void> {
    const series = computeSeries(sig.indicator as string, sig.params ?? {}, candles);
    if (!series || series.length === 0) return;
    const compareSeries = resolveCompareSeries(sig.compareTo, candles, series.length);
    if (!compareSeries) return;

    const i = series.length - 1;
    const truth = evaluateCondition(sig.condition as SignalCondition, series, compareSeries, i);
    const sigId = String(sig._id);
    const prev = this.lastTruth.get(sigId) ?? false;
    this.lastTruth.set(sigId, truth);

    // Only emit on rising edge for crossover conditions, or every bar for level conditions
    const isCrossover = sig.condition === 'crosses-above' || sig.condition === 'crosses-below';
    if (isCrossover && (!truth || prev)) return;
    if (!isCrossover && !truth) return;

    const value = series[i];
    const compared = compareSeries[i];
    if (value === undefined || compared === undefined) return;
    if (isNaN(value) || isNaN(compared)) return;

    const event: SignalEvent = {
      signalId: sigId,
      instrumentToken: token,
      timeframe: sig.timeframe as string,
      ts: new Date(),
      value,
      comparedTo: compared,
      candleTime: candles[i]!.t,
    };
    await this.deps.pubsub.publish(channels.signal(sigId), event);
  }
}

function computeSeries(indicator: string, params: Record<string, unknown>, candles: Candle[]): number[] | null {
  const close = candles.map((c) => c.c);
  const period = num(params['period'], 14);
  switch (indicator) {
    case 'SMA':
      return sma(close, period);
    case 'EMA':
      return ema(close, period);
    case 'RSI':
      return rsi(close, period);
    case 'BOLLINGER': {
      const b = bollinger(close, period, num(params['stdDev'], 2));
      return b.middle;
    }
    case 'MACD':
      return macd(close, num(params['fastPeriod'], 12), num(params['slowPeriod'], 26)).macd;
    case 'SUPERTREND':
      return supertrend(candles, period, num(params['multiplier'], 3)).line;
    case 'VWAP':
      return vwap(candles);
    case 'PRICE':
      return close;
    default:
      return null;
  }
}

function resolveCompareSeries(
  compareTo: unknown,
  candles: Candle[],
  len: number,
): number[] | null {
  if (typeof compareTo !== 'object' || compareTo === null) return null;
  const ct = compareTo as { type: string; value?: number; indicator?: string; params?: Record<string, unknown>; source?: string };
  if (ct.type === 'value' && typeof ct.value === 'number') {
    return new Array(len).fill(ct.value);
  }
  if (ct.type === 'price' && ct.source) {
    return candles.map((c) =>
      ({ open: c.o, high: c.h, low: c.l, close: c.c }[ct.source as 'open' | 'high' | 'low' | 'close']),
    );
  }
  if (ct.type === 'indicator' && ct.indicator) {
    return computeSeries(ct.indicator, ct.params ?? {}, candles);
  }
  return null;
}

function evaluateCondition(
  cond: SignalCondition,
  a: number[],
  b: number[],
  i: number,
): boolean {
  switch (cond) {
    case 'crosses-above':
      return crossesAbove(a, b, i);
    case 'crosses-below':
      return crossesBelow(a, b, i);
    case 'greater-than': {
      const av = a[i];
      const bv = b[i];
      return av !== undefined && bv !== undefined && !isNaN(av) && !isNaN(bv) && av > bv;
    }
    case 'less-than': {
      const av = a[i];
      const bv = b[i];
      return av !== undefined && bv !== undefined && !isNaN(av) && !isNaN(bv) && av < bv;
    }
    case 'equal-to': {
      const av = a[i];
      const bv = b[i];
      return av !== undefined && bv !== undefined && !isNaN(av) && !isNaN(bv) && Math.abs(av - bv) < 1e-6;
    }
    case 'between':
      return false; // requires range, handled by separate logic in builder
    default:
      return false;
  }
}

function num(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}
