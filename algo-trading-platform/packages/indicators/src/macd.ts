import { ema } from './ema.js';

export type MACDResult = {
  macd: number[];
  signal: number[];
  histogram: number[];
};

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const macdLine = values.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    if (f === undefined || s === undefined || isNaN(f) || isNaN(s)) return NaN;
    return f - s;
  });
  // Signal is EMA of MACD, computed only over the defined portion.
  const validFrom = macdLine.findIndex((v) => !isNaN(v));
  const validSlice = validFrom >= 0 ? macdLine.slice(validFrom) : [];
  const sigSlice = ema(validSlice, signalPeriod);
  const signal: number[] = new Array(macdLine.length).fill(NaN);
  for (let i = 0; i < sigSlice.length; i++) signal[validFrom + i] = sigSlice[i]!;

  const histogram = macdLine.map((m, i) => {
    const s = signal[i];
    if (isNaN(m) || s === undefined || isNaN(s)) return NaN;
    return m - s;
  });
  return { macd: macdLine, signal, histogram };
}
