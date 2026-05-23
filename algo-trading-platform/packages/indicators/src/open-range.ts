import type { Candle } from '@algo/shared-types';

/**
 * Open range high/low — the high and low recorded during the first `windowMinutes` of the IST
 * trading session (default: 09:15–09:30 = 15 min).
 */
export function openRange(candles: Candle[], windowMinutes = 15): { orh: number; orl: number } {
  let h = -Infinity;
  let l = Infinity;
  let sessionStart: number | null = null;
  for (const c of candles) {
    const utcMin = c.t.getUTCHours() * 60 + c.t.getUTCMinutes();
    const istMin = (utcMin + 5 * 60 + 30) % (24 * 60);
    if (istMin < 555) continue; // pre-open
    if (sessionStart === null) sessionStart = istMin;
    if (istMin - sessionStart >= windowMinutes) break;
    if (c.h > h) h = c.h;
    if (c.l < l) l = c.l;
  }
  return { orh: h === -Infinity ? NaN : h, orl: l === Infinity ? NaN : l };
}
