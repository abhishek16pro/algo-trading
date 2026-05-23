import type { NormalizedInstrument, Underlying } from '@algo/shared-types';

const UNDERLYINGS: { name: Underlying; spot: number; strikeStep: number; lotSize: number }[] = [
  { name: 'NIFTY', spot: 24500, strikeStep: 50, lotSize: 25 },
  { name: 'BANKNIFTY', spot: 52000, strikeStep: 100, lotSize: 15 },
  { name: 'SENSEX', spot: 80000, strikeStep: 100, lotSize: 10 },
  { name: 'FINNIFTY', spot: 24000, strikeStep: 50, lotSize: 25 },
  { name: 'MIDCPNIFTY', spot: 13000, strikeStep: 25, lotSize: 50 },
];

const STRIKE_RANGE = 20; // ±20 strikes around ATM

/** Build a deterministic, decent-sized instrument set: indices, futures, options chains. */
export function generateMockInstruments(now: Date = new Date()): NormalizedInstrument[] {
  const out: NormalizedInstrument[] = [];
  const thisWeek = nextWeekday(now, 4); // Thursday — NIFTY weekly expiry
  const nextWeek = new Date(thisWeek.getTime() + 7 * 24 * 3600_000);
  const monthly = lastWeekdayOfMonth(now, 4);

  for (const u of UNDERLYINGS) {
    // Index
    out.push({
      tradingsymbol: u.name,
      exchange: u.name === 'SENSEX' ? 'BSE' : 'NSE',
      instrumentToken: `IDX:${u.name}`,
      brokerTokens: { mock: `IDX:${u.name}` },
      segment: 'IDX',
      instrumentType: 'IDX',
      name: `${u.name} Index`,
      lotSize: 1,
      tickSize: 0.05,
      underlying: u.name,
    });

    // Current-month FUT
    const futSym = `${u.name}${formatExpiryFut(monthly)}FUT`;
    out.push({
      tradingsymbol: futSym,
      exchange: u.name === 'SENSEX' ? 'BFO' : 'NFO',
      instrumentToken: `FUT:${u.name}:${monthly.toISOString().slice(0, 10)}`,
      brokerTokens: {},
      segment: 'FUT',
      instrumentType: 'FUT',
      name: `${u.name} ${monthly.toLocaleDateString()} FUT`,
      expiry: monthly,
      lotSize: u.lotSize,
      tickSize: 0.05,
      underlying: u.name,
    });

    // Weekly options chain (this + next week)
    for (const expiry of [thisWeek, nextWeek, monthly]) {
      const atm = Math.round(u.spot / u.strikeStep) * u.strikeStep;
      for (let off = -STRIKE_RANGE; off <= STRIKE_RANGE; off++) {
        const strike = atm + off * u.strikeStep;
        for (const t of ['CE', 'PE'] as const) {
          const sym = `${u.name}${formatExpiryOpt(expiry)}${strike}${t}`;
          out.push({
            tradingsymbol: sym,
            exchange: u.name === 'SENSEX' ? 'BFO' : 'NFO',
            instrumentToken: `OPT:${u.name}:${expiry.toISOString().slice(0, 10)}:${strike}:${t}`,
            brokerTokens: {},
            segment: 'OPT',
            instrumentType: t,
            name: `${u.name} ${expiry.toLocaleDateString()} ${strike} ${t}`,
            expiry,
            strike,
            lotSize: u.lotSize,
            tickSize: 0.05,
            underlying: u.name,
          });
        }
      }
    }
  }
  return out;
}

function nextWeekday(from: Date, targetDow: number): Date {
  const d = new Date(from);
  d.setHours(15, 30, 0, 0);
  const cur = d.getDay();
  let add = (targetDow - cur + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

function lastWeekdayOfMonth(from: Date, targetDow: number): Date {
  const y = from.getFullYear();
  const m = from.getMonth();
  const last = new Date(y, m + 1, 0, 15, 30, 0, 0);
  while (last.getDay() !== targetDow) last.setDate(last.getDate() - 1);
  return last;
}

function formatExpiryFut(d: Date): string {
  // FYY MMM — close to NSE format: 24OCT
  const yy = d.getFullYear().toString().slice(2);
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][
    d.getMonth()
  ];
  return `${yy}${mon}`;
}

function formatExpiryOpt(d: Date): string {
  // For weekly: 24O31 (YY + month-letter + DD). For monthly: 24OCT.
  const yy = d.getFullYear().toString().slice(2);
  const mLetter = 'JFMAMJJASOND'[d.getMonth()];
  const dd = d.getDate().toString().padStart(2, '0');
  return `${yy}${mLetter}${dd}`;
}
