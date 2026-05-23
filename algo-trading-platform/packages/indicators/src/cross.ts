/**
 * Crossover detection: returns `true` if `a` crossed above `b` at the current index relative to
 * the previous. NaN-tolerant: returns false if either prior or current sample is NaN.
 */
export function crossesAbove(a: number[], b: number[], i: number): boolean {
  if (i <= 0 || i >= a.length || i >= b.length) return false;
  const aPrev = a[i - 1];
  const bPrev = b[i - 1];
  const aCur = a[i];
  const bCur = b[i];
  if (aPrev === undefined || bPrev === undefined || aCur === undefined || bCur === undefined)
    return false;
  if (Number.isNaN(aPrev) || Number.isNaN(bPrev) || Number.isNaN(aCur) || Number.isNaN(bCur))
    return false;
  return aPrev <= bPrev && aCur > bCur;
}

export function crossesBelow(a: number[], b: number[], i: number): boolean {
  if (i <= 0 || i >= a.length || i >= b.length) return false;
  const aPrev = a[i - 1];
  const bPrev = b[i - 1];
  const aCur = a[i];
  const bCur = b[i];
  if (aPrev === undefined || bPrev === undefined || aCur === undefined || bCur === undefined)
    return false;
  if (Number.isNaN(aPrev) || Number.isNaN(bPrev) || Number.isNaN(aCur) || Number.isNaN(bCur))
    return false;
  return aPrev >= bPrev && aCur < bCur;
}
