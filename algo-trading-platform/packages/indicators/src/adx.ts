import type { Candle } from '@algo/shared-types';

export type ADXResult = { adx: number[]; pdi: number[]; mdi: number[] };

export function adx(candles: Candle[], period = 14): ADXResult {
  const n = candles.length;
  const out: ADXResult = {
    adx: new Array(n).fill(NaN),
    pdi: new Array(n).fill(NaN),
    mdi: new Array(n).fill(NaN),
  };
  if (n <= period * 2) return out;

  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    const upMove = c.h - p.h;
    const downMove = p.l - c.l;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
  }

  let smTR = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 1; i <= period; i++) {
    smTR += tr[i];
    smPlus += plusDM[i];
    smMinus += minusDM[i];
  }
  out.pdi[period] = (smPlus / smTR) * 100;
  out.mdi[period] = (smMinus / smTR) * 100;
  const dxs: number[] = [];
  dxs.push(dx(out.pdi[period]!, out.mdi[period]!));

  for (let i = period + 1; i < n; i++) {
    smTR = smTR - smTR / period + tr[i];
    smPlus = smPlus - smPlus / period + plusDM[i];
    smMinus = smMinus - smMinus / period + minusDM[i];
    out.pdi[i] = (smPlus / smTR) * 100;
    out.mdi[i] = (smMinus / smTR) * 100;
    dxs.push(dx(out.pdi[i]!, out.mdi[i]!));
    if (dxs.length >= period) {
      const slice = dxs.slice(-period);
      out.adx[i] = slice.reduce((a, b) => a + b, 0) / period;
    }
  }
  return out;
}

function dx(plus: number, minus: number): number {
  const sum = plus + minus;
  if (sum === 0) return 0;
  return (Math.abs(plus - minus) / sum) * 100;
}
