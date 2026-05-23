import type { Redis } from 'ioredis';
import { Cron } from 'croner';
import { InstrumentModel, OrderModel, type StrategyDoc } from '@algo/db';
import { RedisKeys, type RedisPubSub } from '@algo/redis-client';
import {
  channels,
  type LegConfig,
  type NormalizedOrderRequest,
  type SignalEvent,
  type Tick,
} from '@algo/shared-types';
import { isMarketHoursNSE, toISTHHmm, type Logger } from '@algo/utils';
import { selectOptionLeg } from './leg-selector.js';
import { placeOrderViaEngine } from './execution-client.js';

/**
 * Live runtime for a single strategy. Subscribes to ticks/signals it cares about and decides when
 * to enter or exit.
 *
 * Order placement is delegated to the execution engine via Redis pub/sub (`exec:place`) so the
 * strategy process never holds broker connections.
 */
/**
 * How long a signal "stays true" after firing — used to evaluate AND/OR combinations across
 * signals on different timeframes. After this many ms, we treat the signal as stale.
 *
 * AlgoTest behavior: signals on the same candle bar count together. 60s is a safe window
 * for 1m–5m strategies; bump if you mix higher timeframes.
 */
const SIGNAL_FRESHNESS_MS = 60_000;

export class StrategyRuntime {
  private tickHandlers = new Map<string, (t: Tick) => void>();
  private signalHandlers = new Map<string, (s: SignalEvent) => void>();
  private timeCron: Cron | undefined;
  private squareOffCron: Cron | undefined;
  private entriesPlaced = 0;
  private paused = false;
  /** signalId → ts when it last fired. Used to evaluate AND/OR. */
  private lastFiredAt = new Map<string, number>();
  /** Lock to prevent double-firing when multiple signals fire at the same instant. */
  private entryInFlight = false;

  constructor(
    private readonly strategy: StrategyDoc,
    private readonly deps: { log: Logger; redis: Redis; pubsub: RedisPubSub },
  ) {}

  async start(): Promise<void> {
    this.deps.log.info({ name: this.strategy.name, type: this.strategy.type }, 'starting strategy');

    // 1. Subscribe to instrument ticks (resolve underlying)
    const tokens = await this.resolveTokens();
    if (tokens.length > 0) {
      await this.deps.pubsub.publish(channels.subscriptionRequest, {
        action: 'subscribe',
        tokens,
        mode: 'quote',
        requesterId: `strategy:${String(this.strategy._id)}`,
      });
      for (const t of tokens) {
        const handler = (tick: Tick) => void this.onTick(tick);
        this.tickHandlers.set(t, handler);
        await this.deps.pubsub.subscribe<Tick>(channels.tick(t), handler);
      }
    }

    // 2. Subscribe to signals
    for (const s of this.strategy.entry?.signals ?? []) {
      if (!s.signalId) continue;
      const handler = (sig: SignalEvent) => void this.onSignal(sig);
      this.signalHandlers.set(s.signalId, handler);
      await this.deps.pubsub.subscribe<SignalEvent>(channels.signal(s.signalId), handler);
    }

    // 3. Cron-based entry triggers
    if (this.strategy.entry?.triggerType === 'time' && this.strategy.entry.time) {
      const [hh, mm] = this.strategy.entry.time.split(':');
      const cron = `0 ${mm} ${hh} * * MON-FRI`;
      this.timeCron = new Cron(cron, { timezone: 'Asia/Kolkata' }, () => void this.onEntryTime());
    }

    // 4. Square-off cron
    if (this.strategy.exit?.timeExit) {
      const [hh, mm] = this.strategy.exit.timeExit.split(':');
      const cron = `0 ${mm} ${hh} * * MON-FRI`;
      this.squareOffCron = new Cron(cron, { timezone: 'Asia/Kolkata' }, () =>
        void this.onSquareOff(),
      );
    }
  }

  async pause(): Promise<void> {
    this.paused = true;
  }

  async stop(): Promise<void> {
    for (const [token, handler] of this.tickHandlers.entries()) {
      await this.deps.pubsub.unsubscribe(channels.tick(token), handler as never);
    }
    for (const [sigId, handler] of this.signalHandlers.entries()) {
      await this.deps.pubsub.unsubscribe(channels.signal(sigId), handler as never);
    }
    const tokens = Array.from(this.tickHandlers.keys());
    if (tokens.length > 0) {
      await this.deps.pubsub.publish(channels.subscriptionRequest, {
        action: 'unsubscribe',
        tokens,
        requesterId: `strategy:${String(this.strategy._id)}`,
      });
    }
    this.timeCron?.stop();
    this.squareOffCron?.stop();
  }

  // ----------------------------------------------------------------------
  private async resolveTokens(): Promise<string[]> {
    if (this.strategy.segment === 'index') {
      const ins = await InstrumentModel.findOne({
        underlying: this.strategy.underlying,
        instrumentType: 'IDX',
      }).lean();
      return ins ? [ins.instrumentToken] : [];
    }
    if (this.strategy.segment === 'futures') {
      const ins = await InstrumentModel.findOne({
        underlying: this.strategy.underlying,
        instrumentType: 'FUT',
      })
        .sort({ expiry: 1 })
        .lean();
      return ins ? [ins.instrumentToken] : [];
    }
    // options — resolve spot for now; specific legs resolved at entry time.
    const ins = await InstrumentModel.findOne({
      underlying: this.strategy.underlying,
      instrumentType: 'IDX',
    }).lean();
    return ins ? [ins.instrumentToken] : [];
  }

  private async onTick(tick: Tick): Promise<void> {
    if (this.paused) return;
    if (!isMarketHoursNSE(new Date())) return;

    // MTM + trailing SL handling could go here; for V1 we leave SL to BracketManager.
    await this.deps.redis.hset(RedisKeys.strategyState(String(this.strategy._id)), {
      lastTick: tick.ltp.toString(),
      lastTickTs: tick.ltt.getTime().toString(),
    });
  }

  private async onSignal(sig: SignalEvent): Promise<void> {
    if (this.paused) return;
    if (!isMarketHoursNSE(new Date())) return;
    if (this.strategy.entry?.triggerType !== 'signal') return;
    if (this.entriesPlaced >= (this.strategy.risk?.maxPositions ?? 1)) return;
    if (this.entryInFlight) return;

    // 1. Mark this signal as freshly fired.
    this.lastFiredAt.set(sig.signalId, Date.now());

    // 2. Evaluate the strategy's signal expression. The first SignalRef's `logic` field acts as
    //    the global combinator (AND/OR). AlgoTest's UI keeps it simple — either ALL signals must
    //    be true, or ANY must be true.
    const refs = this.strategy.entry.signals ?? [];
    if (refs.length === 0) return;
    const combinator = (refs[0]?.logic ?? 'AND') as 'AND' | 'OR';
    const cutoff = Date.now() - SIGNAL_FRESHNESS_MS;
    const fresh = (id: string): boolean => (this.lastFiredAt.get(id) ?? 0) >= cutoff;
    const satisfied =
      combinator === 'AND'
        ? refs.every((r) => r.signalId && fresh(r.signalId))
        : refs.some((r) => r.signalId && fresh(r.signalId));

    if (!satisfied) return;

    // 3. Fire entry. If legs are configured, treat as options multi-leg. Otherwise single FUT/IDX.
    this.entryInFlight = true;
    try {
      const legs = this.strategy.entry.legs ?? [];
      if (this.strategy.segment === 'options' && legs.length > 0) {
        await this.fireLegs(legs as LegConfig[]);
      } else {
        await this.fireSingleLeg();
      }
      // Reset truth map so the next entry needs a fresh round of signal fires.
      this.lastFiredAt.clear();
    } finally {
      this.entryInFlight = false;
    }
  }

  private async fireSingleLeg(): Promise<void> {
    const ins = await InstrumentModel.findOne({
      underlying: this.strategy.underlying,
      instrumentType: this.strategy.segment === 'futures' ? 'FUT' : 'IDX',
    })
      .sort({ expiry: 1 })
      .lean();
    if (!ins) {
      this.deps.log.warn({ underlying: this.strategy.underlying }, 'no instrument for single-leg entry');
      return;
    }
    const lots = (this.strategy.risk?.lotMultiplier ?? 1) * (ins.lotSize ?? 1);
    const req: NormalizedOrderRequest = {
      tradingsymbol: ins.tradingsymbol,
      exchange: ins.exchange as 'NSE' | 'BSE' | 'NFO' | 'BFO' | 'MCX',
      side: 'BUY',
      quantity: lots,
      orderType: 'MARKET',
      product: this.strategy.segment === 'futures' ? 'NRML' : 'MIS',
      validity: 'DAY',
      tag: `${String(this.strategy._id)}-entry`,
    };
    await this.placeOrder(req);
    this.entriesPlaced += 1;
  }

  private async fireLegs(legs: LegConfig[]): Promise<void> {
    for (const leg of legs) {
      try {
        const placement = await selectOptionLeg(this.deps.redis, this.strategy, leg);
        if (!placement) {
          this.deps.log.warn({ legId: leg.legId }, 'leg resolution returned no contract');
          continue;
        }
        await this.placeOrder(placement);
        this.entriesPlaced += 1;
      } catch (err) {
        this.deps.log.error({ err, legId: leg.legId }, 'leg placement failed');
      }
    }
  }

  private async onEntryTime(): Promise<void> {
    if (this.paused) return;
    if (!isMarketHoursNSE(new Date())) return;
    if (this.entryInFlight) return;
    this.entryInFlight = true;
    try {
      const legs = this.strategy.entry?.legs ?? [];
      if (legs.length === 0) {
        await this.fireSingleLeg();
      } else {
        await this.fireLegs(legs as LegConfig[]);
      }
    } finally {
      this.entryInFlight = false;
    }
  }

  private async onSquareOff(): Promise<void> {
    // Cancel pending and square open positions tagged for this strategy.
    const openOrders = await OrderModel.find({
      strategyId: this.strategy._id,
      status: { $in: ['OPEN', 'PENDING', 'PARTIAL', 'QUEUED', 'SENT'] },
    });
    for (const o of openOrders) {
      await this.deps.pubsub.publish('exec:cancel', {
        orderId: String(o._id),
        userId: String(o.userId),
        brokerAccountId: String(o.brokerAccountId),
        mode: o.mode,
      });
    }
    this.deps.log.info({ now: toISTHHmm(new Date()) }, 'square-off triggered');
  }

  private async placeOrder(req: NormalizedOrderRequest): Promise<void> {
    if (!this.strategy.brokerAccountId && this.strategy.mode === 'live') {
      this.deps.log.warn('live strategy has no brokerAccountId — refusing');
      return;
    }
    await placeOrderViaEngine(this.deps.pubsub, {
      req,
      ctx: {
        userId: String(this.strategy.userId),
        brokerAccountId: String(this.strategy.brokerAccountId ?? 'dev-mock'),
        mode: this.strategy.mode as 'live' | 'paper',
        strategyId: String(this.strategy._id),
      },
    });
  }
}
