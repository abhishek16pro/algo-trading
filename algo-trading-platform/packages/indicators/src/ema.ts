export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i]! * k + out[i - 1]! * (1 - k);
  }
  return out;
}
