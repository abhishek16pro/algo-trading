import type { Candle } from '@algo/shared-types';

/**
 * Wilder's Average True Range.
 */
export function atr(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;

  const tr: number[] = new Array(candles.length).fill(NaN);
  tr[0] = candles[0]!.h - candles[0]!.l;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    tr[i] = Math.max(
      c.h - c.l,
      Math.abs(c.h - prev.c),
      Math.abs(c.l - prev.c),
    );
  }
  // Seed with simple average of first `period` true ranges
  let acc = 0;
  for (let i = 1; i <= period; i++) acc += tr[i]!;
  out[period] = acc / period;
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
}
