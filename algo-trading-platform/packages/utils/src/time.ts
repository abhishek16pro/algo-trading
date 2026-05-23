/**
 * Time / calendar helpers. All "market" times are interpreted in Asia/Kolkata regardless of host TZ.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function nowIST(): Date {
  return new Date();
}

/** Convert any Date to "HH:mm" in IST. */
export function toISTHHmm(d: Date): string {
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const total = ((utcMin + IST_OFFSET_MINUTES) % (24 * 60) + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const mm = (total % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Parse "HH:mm" string. Throws on bad format. */
export function parseHHmm(s: string): { hh: number; mm: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid HH:mm string: ${s}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) throw new Error(`Out of range: ${s}`);
  return { hh, mm };
}

/** Build a Date for today in IST at the given HH:mm. */
export function todayISTAt(hhmm: string): Date {
  const { hh, mm } = parseHHmm(hhmm);
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const y = istNow.getUTCFullYear();
  const mo = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const utc = Date.UTC(y, mo, d, hh, mm) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utc);
}

export const NSE_DAYS = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI']);

export function istDayCode(d: Date = new Date()): 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' {
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return (['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const)[ist.getUTCDay()]!;
}

export function isMarketHoursNSE(d: Date = new Date()): boolean {
  const hhmm = toISTHHmm(d);
  return hhmm >= '09:15' && hhmm <= '15:30' && NSE_DAYS.has(istDayCode(d));
}

export function isPreOpenNSE(d: Date = new Date()): boolean {
  const hhmm = toISTHHmm(d);
  return hhmm >= '09:00' && hhmm < '09:08' && NSE_DAYS.has(istDayCode(d));
}

export function floorToTimeframe(d: Date, tfMinutes: number): Date {
  const ms = tfMinutes * 60_000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
