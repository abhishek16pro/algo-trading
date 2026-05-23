export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  // NaN-aware: only emit a value when the full window has finite numbers. Costs O(n*period)
  // but immune to NaN poisoning when this SMA consumes the output of another indicator.
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let valid = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (v !== undefined && !Number.isNaN(v)) {
        sum += v;
        valid += 1;
      }
    }
    if (valid === period) out[i] = sum / period;
  }
  return out;
}

export function wma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += values[i - j]! * (period - j);
    out[i] = acc / denom;
  }
  return out;
}
