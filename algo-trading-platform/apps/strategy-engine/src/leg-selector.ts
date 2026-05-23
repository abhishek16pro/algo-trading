import type { Redis } from 'ioredis';
import { InstrumentModel, type StrategyDoc, type StrategyLean } from '@algo/db';
import { RedisKeys } from '@algo/redis-client';
import { channels, type LegConfig, type NormalizedOrderRequest } from '@algo/shared-types';
import { sleep } from '@algo/utils';
import type { RedisPubSub } from '@algo/redis-client';

const CHAIN_RADIUS = 10; // candidates considered around ATM for closest-premium / delta-based
const WARMUP_MS = 3_000; // wait for ticks to populate after subscribing

export type LegSelectorDeps = {
  redis: Redis;
  pubsub: RedisPubSub;
};

/**
 * Resolves a strategy leg to a concrete option contract.
 *
 * Strike selection modes:
 *   - ATM / ITM / OTM   — synchronous, offset-based. Cheap.
 *   - closest-premium   — async. Subscribes ATM±10 strikes, waits 3s, picks strike whose LTP
 *                          is nearest to `targetPremium`. Unsubscribes the rejects.
 *   - delta-based       — async. Same chain expansion, but picks by closest delta.
 *                          Delta estimation here is a simple price-distance approximation
 *                          since we don't have a live Greeks feed. Good enough for ATM-near
 *                          strikes; not great for deep OTM/ITM. For production-grade Greeks,
 *                          wire in a Black-Scholes calculator using ATM IV + spot + days-to-expiry.
 */
export async function selectOptionLeg(
  deps: LegSelectorDeps | Redis,
  strategy: StrategyDoc | StrategyLean,
  leg: LegConfig,
): Promise<NormalizedOrderRequest | null> {
  // Back-compat: callers used to pass `redis` directly. Accept both shapes.
  const d: LegSelectorDeps =
    deps && typeof (deps as LegSelectorDeps).redis !== 'undefined' && 'pubsub' in deps
      ? (deps as LegSelectorDeps)
      : { redis: deps as Redis, pubsub: undefined as unknown as RedisPubSub };

  const spotIns = await InstrumentModel.findOne({
    underlying: strategy.underlying,
    instrumentType: 'IDX',
  }).lean();
  if (!spotIns) return null;

  const spotRaw = await d.redis.hget(RedisKeys.tickLast(spotIns.instrumentToken), 'ltp');
  const spot = spotRaw ? Number(spotRaw) : 0;
  if (!spot) return null;

  const sampleStrikes = await InstrumentModel.find({
    underlying: strategy.underlying,
    instrumentType: 'CE',
  })
    .sort({ strike: 1 })
    .limit(5)
    .lean();
  const step = inferStep(sampleStrikes.map((r) => r.strike).filter((s): s is number => typeof s === 'number'));
  const atm = Math.round(spot / step) * step;

  const expiry = await pickExpiry(strategy.underlying, leg.expiry);
  if (!expiry) return null;

  let strike: number | null = null;

  if (leg.strikeSelection === 'ATM') {
    strike = atm + (leg.strikeOffset ?? 0) * step;
  } else if (leg.strikeSelection === 'OTM') {
    strike =
      leg.optionType === 'CE'
        ? atm + Math.abs(leg.strikeOffset ?? 1) * step
        : atm - Math.abs(leg.strikeOffset ?? 1) * step;
  } else if (leg.strikeSelection === 'ITM') {
    strike =
      leg.optionType === 'CE'
        ? atm - Math.abs(leg.strikeOffset ?? 1) * step
        : atm + Math.abs(leg.strikeOffset ?? 1) * step;
  } else if (leg.strikeSelection === 'closest-premium') {
    strike = await resolveClosestPremium(d, strategy.underlying as string, leg, atm, step, expiry);
  } else if (leg.strikeSelection === 'delta-based') {
    strike = await resolveByDelta(d, strategy.underlying as string, leg, atm, step, expiry, spot);
  }

  if (strike === null) return null;

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

// ──────────────────────────────────────────────────────────────── closest-premium
async function resolveClosestPremium(
  d: LegSelectorDeps,
  underlying: string,
  leg: LegConfig,
  atm: number,
  step: number,
  expiry: Date,
): Promise<number | null> {
  const target = leg.targetPremium;
  if (!target || target <= 0) return atm;

  const candidates = await fetchChainCandidates(underlying, leg.optionType, atm, step, expiry);
  if (candidates.length === 0) return null;

  const tokens = candidates.map((c) => c.instrumentToken);
  await subscribeChain(d, tokens);
  await sleep(WARMUP_MS);

  // Pick strike with min |ltp - target| where ltp > 0 (illiquid strikes show 0)
  let best: { strike: number; ltp: number; diff: number } | null = null;
  for (const c of candidates) {
    const ltpRaw = await d.redis.hget(RedisKeys.tickLast(c.instrumentToken), 'ltp');
    const ltp = Number(ltpRaw ?? 0);
    if (!ltp) continue;
    const diff = Math.abs(ltp - target);
    if (!best || diff < best.diff) best = { strike: c.strike, ltp, diff };
  }

  // Drop subs for everything except the winner so we don't keep streaming the chain forever
  const winnerToken = best
    ? candidates.find((c) => c.strike === best!.strike)?.instrumentToken
    : null;
  await unsubscribeChain(
    d,
    tokens.filter((t) => t !== winnerToken),
  );

  return best?.strike ?? null;
}

// ──────────────────────────────────────────────────────────────── delta-based (approximate)
async function resolveByDelta(
  d: LegSelectorDeps,
  underlying: string,
  leg: LegConfig,
  atm: number,
  step: number,
  expiry: Date,
  spot: number,
): Promise<number | null> {
  const target = leg.targetDelta;
  if (target === undefined || target === null) return atm;

  const candidates = await fetchChainCandidates(underlying, leg.optionType, atm, step, expiry);
  if (candidates.length === 0) return null;

  const tokens = candidates.map((c) => c.instrumentToken);
  await subscribeChain(d, tokens);
  await sleep(WARMUP_MS);

  // Approximate delta with the cumulative normal of the standardized log-moneyness.
  // True Greeks need IV+T+r; this approx is good for liquid near-ATM strikes.
  // For each candidate: read ltp, then estimate delta from price/intrinsic ratio.
  // CE delta ≈ 0.5 at ATM, → 1.0 as deep ITM, → 0 as deep OTM.
  // PE delta ≈ -0.5 at ATM, → -1.0 as deep ITM, → 0 as deep OTM.
  let best: { strike: number; delta: number; diff: number } | null = null;
  for (const c of candidates) {
    const ltpRaw = await d.redis.hget(RedisKeys.tickLast(c.instrumentToken), 'ltp');
    const ltp = Number(ltpRaw ?? 0);
    if (!ltp) continue;
    const moneyness = (spot - c.strike) / spot; // CE: + when ITM
    const deltaCE = sigmoid(moneyness * 30);     // crude approximation
    const delta = leg.optionType === 'CE' ? deltaCE : deltaCE - 1;
    const diff = Math.abs(delta - target);
    if (!best || diff < best.diff) best = { strike: c.strike, delta, diff };
  }

  const winnerToken = best
    ? candidates.find((c) => c.strike === best!.strike)?.instrumentToken
    : null;
  await unsubscribeChain(
    d,
    tokens.filter((t) => t !== winnerToken),
  );

  return best?.strike ?? null;
}

// ──────────────────────────────────────────────────────────────── helpers
async function fetchChainCandidates(
  underlying: string,
  optionType: 'CE' | 'PE',
  atm: number,
  step: number,
  expiry: Date,
): Promise<{ strike: number; instrumentToken: string }[]> {
  const low = atm - CHAIN_RADIUS * step;
  const high = atm + CHAIN_RADIUS * step;
  const rows = await InstrumentModel.find({
    underlying,
    instrumentType: optionType,
    expiry,
    strike: { $gte: low, $lte: high },
  })
    .sort({ strike: 1 })
    .lean();
  return rows
    .filter((r) => typeof r.strike === 'number')
    .map((r) => ({ strike: r.strike as number, instrumentToken: r.instrumentToken }));
}

async function subscribeChain(d: LegSelectorDeps, tokens: string[]): Promise<void> {
  if (!d.pubsub || tokens.length === 0) return;
  await d.pubsub.publish(channels.subscriptionRequest, {
    action: 'subscribe',
    tokens,
    mode: 'quote',
    requesterId: 'leg-selector:chain',
  });
}

async function unsubscribeChain(d: LegSelectorDeps, tokens: string[]): Promise<void> {
  if (!d.pubsub || tokens.length === 0) return;
  await d.pubsub.publish(channels.subscriptionRequest, {
    action: 'unsubscribe',
    tokens,
    requesterId: 'leg-selector:chain',
  });
}

function inferStep(strikes: number[]): number {
  strikes.sort((a, b) => a - b);
  for (let i = 1; i < strikes.length; i++) {
    const diff = strikes[i]! - strikes[i - 1]!;
    if (diff > 0) return diff;
  }
  return 50;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
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
