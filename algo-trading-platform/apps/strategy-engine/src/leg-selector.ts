import type { Redis } from 'ioredis';
import { InstrumentModel, type StrategyDoc } from '@algo/db';
import { RedisKeys } from '@algo/redis-client';
import type { LegConfig, NormalizedOrderRequest } from '@algo/shared-types';

/**
 * Given a strategy leg config, picks the concrete option contract and returns a
 * NormalizedOrderRequest. Returns null if no suitable contract found (e.g. illiquid premium target).
 */
export async function selectOptionLeg(
  redis: Redis,
  strategy: StrategyDoc,
  leg: LegConfig,
): Promise<NormalizedOrderRequest | null> {
  const spotIns = await InstrumentModel.findOne({
    underlying: strategy.underlying,
    instrumentType: 'IDX',
  }).lean();
  if (!spotIns) return null;

  const spotRaw = await redis.hget(RedisKeys.tickLast(spotIns.instrumentToken), 'ltp');
  const spot = spotRaw ? Number(spotRaw) : 0;
  if (!spot) return null;

  const stepRow = await InstrumentModel.find({
    underlying: strategy.underlying,
    instrumentType: 'CE',
  })
    .sort({ strike: 1 })
    .limit(3)
    .lean();
  const step = inferStep(stepRow.map((r) => r.strike).filter((s): s is number => typeof s === 'number'));

  const atm = Math.round(spot / step) * step;
  let strike = atm;
  if (leg.strikeSelection === 'ATM') strike = atm + (leg.strikeOffset ?? 0) * step;
  else if (leg.strikeSelection === 'OTM')
    strike = leg.optionType === 'CE'
      ? atm + Math.abs(leg.strikeOffset ?? 1) * step
      : atm - Math.abs(leg.strikeOffset ?? 1) * step;
  else if (leg.strikeSelection === 'ITM')
    strike = leg.optionType === 'CE'
      ? atm - Math.abs(leg.strikeOffset ?? 1) * step
      : atm + Math.abs(leg.strikeOffset ?? 1) * step;

  const expiry = await pickExpiry(strategy.underlying, leg.expiry);
  if (!expiry) return null;

  const ins = await InstrumentModel.findOne({
    underlying: strategy.underlying,
    instrumentType: leg.optionType,
    strike,
    expiry,
  }).lean();
  if (!ins) return null;

  return {
    tradingsymbol: ins.tradingsymbol,
    exchange: ins.exchange as 'NFO' | 'BFO',
    side: leg.action,
    quantity: ins.lotSize * leg.lots,
    orderType: 'MARKET',
    product: 'NRML',
    validity: 'DAY',
    tag: `${String(strategy._id)}-${leg.legId}`,
  };
}

function inferStep(strikes: number[]): number {
  strikes.sort((a, b) => a - b);
  for (let i = 1; i < strikes.length; i++) {
    const diff = strikes[i]! - strikes[i - 1]!;
    if (diff > 0) return diff;
  }
  return 50;
}

async function pickExpiry(
  underlying: StrategyDoc['underlying'],
  pref: LegConfig['expiry'],
): Promise<Date | null> {
  const rows = await InstrumentModel.aggregate<{ _id: Date }>([
    {
      $match: {
        underlying,
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
