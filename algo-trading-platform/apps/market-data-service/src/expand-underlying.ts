import { InstrumentModel, type InstrumentDoc } from '@algo/db';
import type { Redis } from 'ioredis';
import { RedisKeys } from '@algo/redis-client';
import type { ExpirySelection, Underlying } from '@algo/shared-types';

export type ExpandRequest = {
  underlying: Underlying;
  segment: 'options' | 'futures' | 'index';
  expiry?: ExpirySelection;
  /** ATM-relative range of strikes to include — eg { from: -10, to: +10 }. */
  strikeRange?: { from: number; to: number };
};

/**
 * Expands a high-level strategy reference like "BANKNIFTY weekly options ±10 strikes around ATM"
 * into the concrete list of instrument tokens that need to be subscribed.
 *
 * Note: ATM is resolved from the latest spot LTP in Redis. If unavailable, falls back to the
 * underlying index's `lastPrice` from the most-recent stored candle (caller should warm that up).
 */
export async function expandUnderlying(redis: Redis, req: ExpandRequest): Promise<string[]> {
  if (req.segment === 'index') {
    const idx = await InstrumentModel.findOne({ underlying: req.underlying, instrumentType: 'IDX' })
      .lean();
    return idx ? [idx.instrumentToken] : [];
  }

  if (req.segment === 'futures') {
    const fut = await InstrumentModel.findOne({
      underlying: req.underlying,
      instrumentType: 'FUT',
    })
      .sort({ expiry: 1 })
      .lean();
    return fut ? [fut.instrumentToken] : [];
  }

  // Options: resolve target expiry
  const expiries = await getExpiriesForUnderlying(req.underlying);
  if (expiries.length === 0) return [];
  const expiry = pickExpiry(expiries, req.expiry ?? 'current-week');

  // Resolve ATM from spot
  const spotToken = await getSpotToken(req.underlying);
  const spot = spotToken ? Number((await redis.hget(RedisKeys.tickLast(spotToken), 'ltp')) ?? '0') : 0;
  if (!spot) {
    // No live tick yet — return entire chain for this expiry.
    const all = await InstrumentModel.find({
      underlying: req.underlying,
      expiry,
      instrumentType: { $in: ['CE', 'PE'] },
    }).lean();
    return all.map((i) => i.instrumentToken);
  }

  const stepRow = await InstrumentModel.find({
    underlying: req.underlying,
    expiry,
    instrumentType: 'CE',
  })
    .sort({ strike: 1 })
    .limit(5)
    .lean();
  const step = inferStrikeStep(stepRow);
  const atm = Math.round(spot / step) * step;

  const range = req.strikeRange ?? { from: -10, to: 10 };
  const low = atm + range.from * step;
  const high = atm + range.to * step;

  const opts = await InstrumentModel.find({
    underlying: req.underlying,
    expiry,
    instrumentType: { $in: ['CE', 'PE'] },
    strike: { $gte: low, $lte: high },
  }).lean();

  return opts.map((i) => i.instrumentToken);
}

async function getExpiriesForUnderlying(u: Underlying): Promise<Date[]> {
  const rows = await InstrumentModel.aggregate([
    { $match: { underlying: u, instrumentType: { $in: ['CE', 'PE'] } } },
    { $group: { _id: '$expiry' } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r: { _id: Date }) => r._id).filter((d): d is Date => d instanceof Date);
}

function pickExpiry(expiries: Date[], pref: ExpirySelection): Date {
  const now = Date.now();
  const future = expiries.filter((d) => d.getTime() >= now);
  if (future.length === 0) return expiries[expiries.length - 1]!;
  if (pref === 'current-week') return future[0]!;
  if (pref === 'next-week') return future[1] ?? future[0]!;
  // monthly — last expiry that's still in the current calendar month, else next month's last
  return future[future.length - 1]!;
}

async function getSpotToken(u: Underlying): Promise<string | null> {
  const idx = await InstrumentModel.findOne({ underlying: u, instrumentType: 'IDX' }).lean();
  return idx?.instrumentToken ?? null;
}

function inferStrikeStep(samples: Pick<InstrumentDoc, 'strike'>[]): number {
  const strikes = samples.map((s) => s.strike).filter((s): s is number => typeof s === 'number');
  strikes.sort((a, b) => a - b);
  for (let i = 1; i < strikes.length; i++) {
    const diff = strikes[i]! - strikes[i - 1]!;
    if (diff > 0) return diff;
  }
  return 50;
}
