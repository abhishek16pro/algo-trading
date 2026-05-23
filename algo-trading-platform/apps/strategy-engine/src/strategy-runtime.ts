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
export class StrategyRuntime {
  private tickHandlers = new Map<string, (t: Tick) => void>();
  private signalHandlers = new Map<string, (s: SignalEvent) => void>();
  private timeCron: Cron | undefined;
  private squareOffCron: Cron | undefined;
  private entriesPlaced = 0;
  private paused = false;

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

  private async onSignal(_sig: SignalEvent): Promise<void> {
    if (this.paused) return;
    if (!isMarketHoursNSE(new Date())) return;
    if (this.strategy.entry?.triggerType !== 'signal') return;
    if (this.entriesPlaced >= (this.strategy.risk?.maxPositions ?? 1)) return;

    // V1: simple single-leg directional entry on signal
    const ins = await InstrumentModel.findOne({
      underlying: this.strategy.underlying,
      instrumentType: this.strategy.segment === 'futures' ? 'FUT' : 'IDX',
    })
      .sort({ expiry: 1 })
      .lean();
    if (!ins) return;
    const lots = (this.strategy.risk?.lotMultiplier ?? 1) * (ins.lotSize ?? 1);
    const req: NormalizedOrderRequest = {
      tradingsymbol: ins.tradingsymbol,
      exchange: ins.exchange as 'NSE' | 'BSE' | 'NFO' | 'BFO' | 'MCX',
      side: 'BUY',
      quantity: lots,
      orderType: 'MARKET',
      product: 'MIS',
      validity: 'DAY',
      tag: `${String(this.strategy._id)}-entry`,
    };
    await this.placeOrder(req);
  }

  private async onEntryTime(): Promise<void> {
    if (this.paused) return;
    if (!isMarketHoursNSE(new Date())) return;

    const legs = this.strategy.entry?.legs ?? [];
    if (legs.length === 0) return;

    for (const leg of legs as LegConfig[]) {
      try {
        const placement = await selectOptionLeg(this.deps.redis, this.strategy, leg);
        if (!placement) continue;
        await this.placeOrder(placement);
        this.entriesPlaced += 1;
      } catch (err) {
        this.deps.log.error({ err, leg: leg.legId }, 'leg placement failed');
      }
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
