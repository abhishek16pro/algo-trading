import type { Redis } from 'ioredis';
import { OrderModel, PositionModel, StrategyModel } from '@algo/db';
import { RedisKeys } from '@algo/redis-client';
import type { NormalizedOrderRequest } from '@algo/shared-types';
import { RiskGateError, toISTHHmm, type Logger } from '@algo/utils';
import type { AdapterRegistry } from './adapter-registry.js';
import type { OrderContext } from './order-router.js';

/** Freeze quantities per leg (NSE FNO rule). Update from circulars. */
const FREEZE_QTY: Record<string, number> = {
  NIFTY: 1800,
  BANKNIFTY: 900,
  FINNIFTY: 1800,
  MIDCPNIFTY: 4200,
  SENSEX: 1000,
};

/** All pre-trade safety checks. Any failure throws RiskGateError with a human reason. */
export class RiskGate {
  constructor(
    private readonly log: Logger,
    private readonly redis: Redis,
    private readonly registry: AdapterRegistry,
  ) {}

  async check(req: NormalizedOrderRequest, ctx: OrderContext): Promise<void> {
    if (ctx.mode === 'live') {
      await this.checkMargin(req, ctx);
    }
    await this.checkFreezeQuantity(req);
    if (ctx.strategyId) {
      await this.checkStrategyConstraints(req, ctx);
    }
    await this.checkRateLimit(ctx);
  }

  private async checkRateLimit(ctx: OrderContext): Promise<void> {
    // Hard cap: 10 orders/minute per user.
    const key = RedisKeys.rateOrder(ctx.userId);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > 10) throw new RiskGateError('rate-limit', { perMinute: 10 });
  }

  private async checkFreezeQuantity(req: NormalizedOrderRequest): Promise<void> {
    const underlying = inferUnderlying(req.tradingsymbol);
    if (!underlying) return;
    const freeze = FREEZE_QTY[underlying];
    if (freeze && req.quantity > freeze) {
      throw new RiskGateError('freeze-quantity', { underlying, requested: req.quantity, max: freeze });
    }
  }

  private async checkMargin(req: NormalizedOrderRequest, ctx: OrderContext): Promise<void> {
    try {
      const adapter = await this.registry.for(ctx.brokerAccountId);
      const funds = await adapter.getFunds();
      const ltpRaw = await this.redis.hget(
        RedisKeys.tickLast((req as { instrumentToken?: string }).instrumentToken ?? req.tradingsymbol),
        'ltp',
      );
      const ltp = ltpRaw ? Number(ltpRaw) : req.price ?? 0;
      const notional = ltp * req.quantity;
      // crude SPAN approximation; in production use broker's margin calculator API.
      const required = notional * 0.2;
      if (required > funds.available) {
        throw new RiskGateError('margin', { required, available: funds.available });
      }
    } catch (err) {
      if (err instanceof RiskGateError) throw err;
      this.log.warn({ err }, 'margin check skipped (adapter error)');
    }
  }

  private async checkStrategyConstraints(
    req: NormalizedOrderRequest,
    ctx: OrderContext,
  ): Promise<void> {
    const strategy = await StrategyModel.findById(ctx.strategyId).lean();
    if (!strategy) return;

    // Kill-switch
    const killed = await this.redis.hget(RedisKeys.strategyState(ctx.strategyId!), 'killSwitch');
    if (killed === '1') throw new RiskGateError('kill-switch');

    // Square-off time
    if (strategy.exit?.timeExit) {
      const now = toISTHHmm(new Date());
      if (now > strategy.exit.timeExit) {
        throw new RiskGateError('square-off-time', { now, cutoff: strategy.exit.timeExit });
      }
    }

    // Daily loss cap
    const dailyPnLRaw = await this.redis.hget(
      RedisKeys.strategyState(ctx.strategyId!),
      'dailyPnL',
    );
    const dailyPnL = dailyPnLRaw ? Number(dailyPnLRaw) : 0;
    if (strategy.risk?.maxLossPerDay && dailyPnL < -Math.abs(strategy.risk.maxLossPerDay)) {
      throw new RiskGateError('daily-loss-cap', {
        dailyPnL,
        cap: strategy.risk.maxLossPerDay,
      });
    }

    // Position count
    const openCount = await PositionModel.countDocuments({
      strategyId: ctx.strategyId,
      closedAt: { $exists: false },
    });
    if (strategy.risk?.maxPositions && openCount >= strategy.risk.maxPositions) {
      throw new RiskGateError('position-cap', { open: openCount, max: strategy.risk.maxPositions });
    }
  }
}

function inferUnderlying(symbol: string): string | null {
  const known = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'BANKEX'];
  for (const u of known) {
    if (symbol.startsWith(u)) return u;
  }
  return null;
}
