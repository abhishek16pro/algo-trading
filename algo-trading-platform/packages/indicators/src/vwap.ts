import type { Candle } from '@algo/shared-types';
import { pickSource, type PriceSource } from './sources.js';

/**
 * Session-anchored VWAP. Resets at the time-of-day given by `anchorMinutesIST`
 * (default 09:15 IST = 555 minutes). Each new IST trading session restarts the cumulator.
 */
export function vwap(candles: Candle[], src: PriceSource = 'hlc3', anchorMinutesIST = 555): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  let curSessionDay = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const utcMin = c.t.getUTCHours() * 60 + c.t.getUTCMinutes();
    const istMin = (utcMin + 5 * 60 + 30) % (24 * 60);
    const istDay = Math.floor((c.t.getTime() + (5 * 60 + 30) * 60_000) / (24 * 3600_000));
    if (istDay !== curSessionDay && istMin >= anchorMinutesIST) {
      cumPV = 0;
      cumV = 0;
      curSessionDay = istDay;
    }
    const price = pickSource(c, src);
    const vol = c.v || 0;
    cumPV += price * vol;
    cumV += vol;
    out[i] = cumV > 0 ? cumPV / cumV : price;
  }
  return out;
}
