import type { FastifyPluginAsync } from 'fastify';
import { InstrumentModel, StrategyModel, type StrategyLean } from '@algo/db';
import { RedisKeys } from '@algo/redis-client';
import type { LegConfig, NormalizedOrderRequest } from '@algo/shared-types';
import { ForbiddenError, NotFoundError } from '@algo/utils';

/**
 * Dry-run leg resolver. Given a strategy's current config and the platform's current market
 * state (spot LTPs in Redis, instruments collection in Mongo), returns the *exact* order
 * bodies that WOULD be placed if the strategy fired right now — without actually placing them.
 *
 * Useful for:
 *   - Verifying SL/TP math before deploying live
 *   - Confirming the correct strike is being picked (ATM/OTM/closest-premium)
 *   - Inspecting the broker order body shape
 *
 * NOTE: this is a synchronous, no-side-effects version. It does NOT subscribe the option chain
 *       for closest-premium/delta-based selection — it uses whatever LTPs are already in Redis.
 *       If those modes return no result, deploy the strategy in paper mode briefly to populate
 *       the cache then re-preview, OR rely on the strategy runtime which does the subscribe.
 */
export const strategyPreviewRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/:id/preview-legs', async (req) => {
    const { id } = req.params as { id: string };
    const strategy = await StrategyModel.findById(id).lean();
    if (!strategy) throw new NotFoundError('Strategy', id);
    if (String(strategy.userId) !== req.user!.userId) throw new ForbiddenError();

    const legs = (strategy.entry?.legs ?? []) as LegConfig[];
    if (legs.length === 0) {
      return { ok: false, message: 'Strategy has no option legs to preview.', resolved: [] };
    }

    // Gather market context
    const spotIns = await InstrumentModel.findOne({
      underlying: strategy.underlying,
      instrumentType: 'IDX',
    }).lean();
    if (!spotIns) {
      return {
        ok: false,
        message: `No index instrument found for ${strategy.underlying}. Did you seed the contract master?`,
        resolved: [],
      };
    }
    const spotRaw = await app.ctx.redis.hget(RedisKeys.tickLast(spotIns.instrumentToken), 'ltp');
    const spot = spotRaw ? Number(spotRaw) : 0;
    if (!spot) {
      return {
        ok: false,
        message: `No live LTP for ${strategy.underlying} (Redis key ${RedisKeys.tickLast(spotIns.instrumentToken)} empty). Is market-data-service running?`,
        resolved: [],
      };
    }

    const sampleStrikes = await InstrumentModel.find({
      underlying: strategy.underlying,
      instrumentType: 'CE',
    })
      .sort({ strike: 1 })
      .limit(5)
      .lean();
    const step = inferStep(
      sampleStrikes.map((r) => r.strike).filter((s): s is number => typeof s === 'number'),
    );
    const atm = Math.round(spot / step) * step;
    const expiry = await pickExpiry(strategy as StrategyLean);
    if (!expiry) {
      return { ok: false, message: 'No matching expiry in the contract master.', resolved: [] };
    }

    const resolved: Array<{
      legId: string;
      strikeSelection: string;
      strikeChosen: number | null;
      expiry: Date;
      tradingsymbol: string | null;
      reason: string;
      order: NormalizedOrderRequest | null;
      slTrigger: number | null;
      tpTrigger: number | null;
    }> = [];

    for (const leg of legs) {
      let strike: number | null = null;
      let reason = '';

      if (leg.strikeSelection === 'ATM') {
        strike = atm + (leg.strikeOffset ?? 0) * step;
        reason = `ATM (${atm}) + ${leg.strikeOffset ?? 0} × ${step}`;
      } else if (leg.strikeSelection === 'OTM') {
        const off = Math.abs(leg.strikeOffset ?? 1);
        strike = leg.optionType === 'CE' ? atm + off * step : atm - off * step;
        reason = `OTM ${off} from ATM ${atm}`;
      } else if (leg.strikeSelection === 'ITM') {
        const off = Math.abs(leg.strikeOffset ?? 1);
        strike = leg.optionType === 'CE' ? atm - off * step : atm + off * step;
        reason = `ITM ${off} from ATM ${atm}`;
      } else if (leg.strikeSelection === 'closest-premium') {
        const target = leg.targetPremium ?? 0;
        // Snap to whatever strikes already have a fresh tick in Redis
        const candidates = await InstrumentModel.find({
          underlying: strategy.underlying,
          instrumentType: leg.optionType,
          expiry,
          strike: { $gte: atm - 10 * step, $lte: atm + 10 * step },
        })
          .sort({ strike: 1 })
          .lean();
        let best: { strike: number; ltp: number; diff: number } | null = null;
        for (const c of candidates) {
          const ltpRaw = await app.ctx.redis.hget(RedisKeys.tickLast(c.instrumentToken), 'ltp');
          const ltp = Number(ltpRaw ?? 0);
          if (!ltp || typeof c.strike !== 'number') continue;
          const diff = Math.abs(ltp - target);
          if (!best || diff < best.diff) best = { strike: c.strike, ltp, diff };
        }
        if (best) {
          strike = best.strike;
          reason = `closest-premium ${target} → strike ${best.strike} (premium ≈ ${best.ltp.toFixed(2)}, diff ${best.diff.toFixed(2)})`;
        } else {
          reason = `closest-premium ${target}: no candidate strikes have fresh LTP in Redis. Deploy paper first or wait for runtime chain subscribe.`;
        }
      } else if (leg.strikeSelection === 'delta-based') {
        reason = `delta-based selection requires chain subscribe — preview cannot evaluate. Deploy paper to observe live.`;
      }

      if (strike === null) {
        resolved.push({
          legId: leg.legId,
          strikeSelection: leg.strikeSelection,
          strikeChosen: null,
          expiry,
          tradingsymbol: null,
          reason,
          order: null,
          slTrigger: null,
          tpTrigger: null,
        });
        continue;
      }

      const ins = await InstrumentModel.findOne({
        underlying: strategy.underlying,
        instrumentType: leg.optionType,
        strike,
        expiry,
      }).lean();
      if (!ins) {
        resolved.push({
          legId: leg.legId,
          strikeSelection: leg.strikeSelection,
          strikeChosen: strike,
          expiry,
          tradingsymbol: null,
          reason: `${reason} — but no instrument row at strike ${strike} expiry ${expiry.toISOString().slice(0, 10)}.`,
          order: null,
          slTrigger: null,
          tpTrigger: null,
        });
        continue;
      }

      // Build the entry order body
      const order: NormalizedOrderRequest = {
        tradingsymbol: ins.tradingsymbol,
        exchange: ins.exchange as 'NFO' | 'BFO',
        side: leg.action,
        quantity: ins.lotSize * leg.lots,
        orderType: 'MARKET',
        product: 'NRML',
        validity: 'DAY',
        tag: `${String(strategy._id)}-${leg.legId}`,
      };

      // Compute the SL/TP triggers we'd fire on entry fill (using current LTP as estimate)
      const ltpRaw = await app.ctx.redis.hget(RedisKeys.tickLast(ins.instrumentToken), 'ltp');
      const estimatedEntryPrice = Number(ltpRaw ?? 0);
      const sl = leg.individualSL ?? strategy.exit?.stopLoss;
      const tp = leg.individualTP ?? strategy.exit?.target;
      const slTrigger =
        sl && sl.value && estimatedEntryPrice
          ? slPrice(estimatedEntryPrice, sl.value, sl.type as 'percent' | 'points' | 'rupees', leg.action)
          : null;
      const tpTrigger =
        tp && tp.value && estimatedEntryPrice
          ? tpPrice(estimatedEntryPrice, tp.value, tp.type as 'percent' | 'points' | 'rupees', leg.action)
          : null;

      resolved.push({
        legId: leg.legId,
        strikeSelection: leg.strikeSelection,
        strikeChosen: strike,
        expiry,
        tradingsymbol: ins.tradingsymbol,
        reason,
        order,
        slTrigger,
        tpTrigger,
      });
    }

    return {
      ok: true,
      context: {
        underlying: strategy.underlying,
        spotPrice: spot,
        atm,
        strikeStep: step,
        expiry,
      },
      resolved,
    };
  });
};

function inferStep(strikes: number[]): number {
  strikes.sort((a, b) => a - b);
  for (let i = 1; i < strikes.length; i++) {
    const diff = strikes[i]! - strikes[i - 1]!;
    if (diff > 0) return diff;
  }
  return 50;
}

async function pickExpiry(strategy: StrategyLean): Promise<Date | null> {
  const pref = (strategy.entry?.legs?.[0] as LegConfig | undefined)?.expiry ?? 'current-week';
  const rows = await InstrumentModel.aggregate<{ _id: Date }>([
    {
      $match: {
        underlying: strategy.underlying,
        instrumentType: { $in: ['CE', 'PE'] },
        expiry: { $gte: new Date() },
      },
    },
    { $group: { _id: '$expiry' } },
    { $sort: { _id: 1 } },
  ]);
  if (rows.length === 0) return null;
  if (pref === 'current-week') return rows[0]!._id;
  if (pref === 'next-week') return (rows[1] ?? rows[0])!._id;
  return rows[rows.length - 1]!._id;
}

function slPrice(
  entry: number,
  value: number,
  type: 'percent' | 'points' | 'rupees',
  side: 'BUY' | 'SELL',
): number {
  const offset = type === 'percent' ? entry * (value / 100) : value;
  return side === 'BUY' ? entry - offset : entry + offset;
}

function tpPrice(
  entry: number,
  value: number,
  type: 'percent' | 'points' | 'rupees',
  side: 'BUY' | 'SELL',
): number {
  const offset = type === 'percent' ? entry * (value / 100) : value;
  return side === 'BUY' ? entry + offset : entry - offset;
}
