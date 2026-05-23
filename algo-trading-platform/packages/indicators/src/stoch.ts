import type { Candle } from '@algo/shared-types';
import { sma } from './sma.js';

export type StochResult = { k: number[]; d: number[] };

export function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): StochResult {
  const n = candles.length;
  const k: number[] = new Array(n).fill(NaN);
  if (n < kPeriod) return { k, d: new Array(n).fill(NaN) };

  for (let i = kPeriod - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j]!.h > hh) hh = candles[j]!.h;
      if (candles[j]!.l < ll) ll = candles[j]!.l;
    }
    const c = candles[i]!.c;
    k[i] = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  }
  const d = sma(k, dPeriod);
  return { k, d };
}
