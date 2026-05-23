import type { Candle } from '@algo/shared-types';

export type PivotLevels = {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

export function classicPivots(prev: Candle): PivotLevels {
  const pp = (prev.h + prev.l + prev.c) / 3;
  return {
    pp,
    r1: 2 * pp - prev.l,
    s1: 2 * pp - prev.h,
    r2: pp + (prev.h - prev.l),
    s2: pp - (prev.h - prev.l),
    r3: prev.h + 2 * (pp - prev.l),
    s3: prev.l - 2 * (prev.h - pp),
  };
}

export type CamarillaLevels = {
  h4: number;
  h3: number;
  h2: number;
  h1: number;
  l1: number;
  l2: number;
  l3: number;
  l4: number;
};

export function camarillaPivots(prev: Candle): CamarillaLevels {
  const range = prev.h - prev.l;
  return {
    h4: prev.c + (range * 1.1) / 2,
    h3: prev.c + (range * 1.1) / 4,
    h2: prev.c + (range * 1.1) / 6,
    h1: prev.c + (range * 1.1) / 12,
    l1: prev.c - (range * 1.1) / 12,
    l2: prev.c - (range * 1.1) / 6,
    l3: prev.c - (range * 1.1) / 4,
    l4: prev.c - (range * 1.1) / 2,
  };
}

export type FibLevels = {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

export function fibonacciPivots(prev: Candle): FibLevels {
  const pp = (prev.h + prev.l + prev.c) / 3;
  const range = prev.h - prev.l;
  return {
    pp,
    r1: pp + 0.382 * range,
    r2: pp + 0.618 * range,
    r3: pp + range,
    s1: pp - 0.382 * range,
    s2: pp - 0.618 * range,
    s3: pp - range,
  };
}
