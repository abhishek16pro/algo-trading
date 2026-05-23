import { sma } from './sma.js';

export type BollingerResult = {
  middle: number[];
  upper: number[];
  lower: number[];
};

export function bollinger(values: number[], period = 20, stdDev = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: number[] = new Array(values.length).fill(NaN);
  const lower: number[] = new Array(values.length).fill(NaN);

  for (let i = period - 1; i < values.length; i++) {
    let varSum = 0;
    const mean = middle[i]!;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j]! - mean;
      varSum += diff * diff;
    }
    const sd = Math.sqrt(varSum / period);
    upper[i] = mean + stdDev * sd;
    lower[i] = mean - stdDev * sd;
  }
  return { middle, upper, lower };
}
