import type { Candle } from '@algo/shared-types';

export type PriceSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';

export function pickSource(c: Candle, src: PriceSource): number {
  switch (src) {
    case 'open':
      return c.o;
    case 'high':
      return c.h;
    case 'low':
      return c.l;
    case 'close':
      return c.c;
    case 'hl2':
      return (c.h + c.l) / 2;
    case 'hlc3':
      return (c.h + c.l + c.c) / 3;
    case 'ohlc4':
      return (c.o + c.h + c.l + c.c) / 4;
  }
}

export function priceSeries(candles: Candle[], src: PriceSource = 'close'): number[] {
  return candles.map((c) => pickSource(c, src));
}
