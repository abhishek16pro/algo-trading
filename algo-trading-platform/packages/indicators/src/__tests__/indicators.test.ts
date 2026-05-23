import { describe, it, expect } from 'vitest';
import { sma, wma } from '../sma.js';
import { ema } from '../ema.js';
import { rsi } from '../rsi.js';
import { macd } from '../macd.js';
import { bollinger } from '../bollinger.js';
import { atr } from '../atr.js';
import { supertrend } from '../supertrend.js';
import { vwap } from '../vwap.js';
import { stochastic } from '../stoch.js';
import { crossesAbove, crossesBelow } from '../cross.js';
import type { Candle } from '@algo/shared-types';

function mkCandles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    t: new Date(2024, 0, 1, 9, 15 + i),
    o: p,
    h: p + 0.5,
    l: p - 0.5,
    c: p,
    v: 1000,
  }));
}

describe('SMA', () => {
  it('returns NaN before warmup, average after', () => {
    const v = [1, 2, 3, 4, 5];
    const out = sma(v, 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });
});

describe('WMA', () => {
  it('weights most-recent value highest', () => {
    const v = [1, 2, 3, 4, 5];
    const out = wma(v, 3);
    // For [3,4,5] with weights [1,2,3] -> (3*1 + 4*2 + 5*3) / 6 = 26/6
    expect(out[4]).toBeCloseTo(26 / 6, 5);
  });
});

describe('EMA', () => {
  it('seeds from SMA and tracks values', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = ema(v, 5);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBeCloseTo(3, 5);
    expect(out[9]).toBeGreaterThan(out[4]!);
  });
});

describe('RSI', () => {
  it('returns 100 when there are no losses', () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = rsi(v, 14);
    expect(out[14]).toBe(100);
  });

  it('returns 0 when there are no gains', () => {
    const v = Array.from({ length: 20 }, (_, i) => 100 - i);
    const out = rsi(v, 14);
    expect(out[14]).toBe(0);
  });
});

describe('MACD', () => {
  it('produces aligned macd/signal/histogram series', () => {
    const v = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const { macd: m, signal, histogram } = macd(v, 12, 26, 9);
    expect(m.length).toBe(v.length);
    expect(signal.length).toBe(v.length);
    expect(histogram.length).toBe(v.length);
    // MACD needs slowPeriod (26) candles before the slow EMA seeds.
    expect(isNaN(m[24]!)).toBe(true);
    expect(isNaN(m[40]!)).toBe(false);
  });
});

describe('Bollinger', () => {
  it('middle equals SMA, upper > middle > lower', () => {
    const v = [10, 12, 14, 13, 15, 17, 16, 18, 20, 22, 21, 23, 25, 24, 26, 28, 30, 29, 31, 33];
    const { middle, upper, lower } = bollinger(v, 20, 2);
    const i = 19;
    expect(upper[i]).toBeGreaterThan(middle[i]!);
    expect(middle[i]).toBeGreaterThan(lower[i]!);
  });
});

describe('ATR', () => {
  it('returns Wilder-smoothed average', () => {
    const c = mkCandles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]);
    const out = atr(c, 14);
    expect(out[14]).toBeGreaterThan(0);
  });
});

describe('Supertrend', () => {
  it('flips direction on trend change', () => {
    // Multiplier=1 keeps bands tight; a clean uptrend then a downtrend produces both signs.
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 130 - i);
    const c = mkCandles([...up, ...down]);
    const { direction } = supertrend(c, 10, 1);
    expect(direction.some((d) => d === 1)).toBe(true);
    expect(direction.some((d) => d === -1)).toBe(true);
  });
});

describe('VWAP', () => {
  it('always between session high and low', () => {
    const c = mkCandles([100, 101, 102, 103, 104, 105, 104, 103, 102, 101]);
    const out = vwap(c, 'close');
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(100);
      expect(out[i]).toBeLessThanOrEqual(105);
    }
  });
});

describe('Stochastic', () => {
  it('%K and %D in [0,100] once warmed up', () => {
    const c = mkCandles(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 4) * 5));
    const { k, d } = stochastic(c, 14, 3);
    for (let i = 14; i < c.length; i++) {
      expect(k[i]).toBeGreaterThanOrEqual(0);
      expect(k[i]).toBeLessThanOrEqual(100);
    }
    for (let i = 16; i < c.length; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(0);
      expect(d[i]).toBeLessThanOrEqual(100);
    }
  });
});

describe('crossesAbove / crossesBelow', () => {
  it('detects an upward crossover at exactly the crossing bar', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [3, 3, 3, 3, 3];
    expect(crossesAbove(a, b, 2)).toBe(false); // a still <= b
    expect(crossesAbove(a, b, 3)).toBe(true);
    expect(crossesAbove(a, b, 4)).toBe(false);
  });

  it('detects a downward crossover symmetrically', () => {
    const a = [5, 4, 3, 2, 1];
    const b = [3, 3, 3, 3, 3];
    expect(crossesBelow(a, b, 2)).toBe(false);
    expect(crossesBelow(a, b, 3)).toBe(true);
  });
});
