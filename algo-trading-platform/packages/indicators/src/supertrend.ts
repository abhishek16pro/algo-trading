import type { Candle } from '@algo/shared-types';
import { atr } from './atr.js';

export type SupertrendResult = {
  /** The Supertrend line value at each bar (NaN until warmup completes). */
  line: number[];
  /** +1 for uptrend, -1 for downtrend, 0 if undefined. */
  direction: (1 | -1 | 0)[];
};

/**
 * Classic Supertrend (close-based).
 *
 *   upperBand = (h + l) / 2 + mult * ATR
 *   lowerBand = (h + l) / 2 - mult * ATR
 *
 *   finalUpper trails the price down (only relaxes upward when a prior close pierced it).
 *   finalLower trails the price up (only relaxes downward when a prior close pierced it).
 *
 *   If supertrend(i-1) was finalUpper, then supertrend(i) stays = finalUpper while close <= finalUpper,
 *   else it flips to finalLower (trend turned up).
 */
export function supertrend(candles: Candle[], period = 10, multiplier = 3): SupertrendResult {
  const n = candles.length;
  const line: number[] = new Array(n).fill(NaN);
  const direction: (1 | -1 | 0)[] = new Array(n).fill(0);
  if (n < period + 1) return { line, direction };

  const atrSeries = atr(candles, period);

  let finalUpper = NaN;
  let finalLower = NaN;
  let prevDir: 1 | -1 = -1;
  let started = false;

  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const a = atrSeries[i];
    if (a === undefined || Number.isNaN(a)) continue;

    const mid = (c.h + c.l) / 2;
    const upperBand = mid + multiplier * a;
    const lowerBand = mid - multiplier * a;

    if (!started) {
      finalUpper = upperBand;
      finalLower = lowerBand;
      prevDir = c.c <= upperBand ? -1 : 1;
      line[i] = prevDir === 1 ? finalLower : finalUpper;
      direction[i] = prevDir;
      started = true;
      continue;
    }

    const prevClose = candles[i - 1]!.c;
    finalUpper =
      upperBand < finalUpper || prevClose > finalUpper ? upperBand : finalUpper;
    finalLower =
      lowerBand > finalLower || prevClose < finalLower ? lowerBand : finalLower;

    let dir: 1 | -1;
    if (prevDir === -1) {
      // Was in downtrend: stay down while close stays at/below finalUpper, flip up otherwise.
      dir = c.c <= finalUpper ? -1 : 1;
    } else {
      // Was in uptrend: stay up while close stays at/above finalLower, flip down otherwise.
      dir = c.c >= finalLower ? 1 : -1;
    }

    line[i] = dir === 1 ? finalLower : finalUpper;
    direction[i] = dir;
    prevDir = dir;
  }
  return { line, direction };
}
