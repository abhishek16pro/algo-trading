import { describe, it, expect } from 'vitest';
import { simulateBrokerage } from '../brokerage.js';

describe('OMS / brokerage integration', () => {
  it('round-trip on NIFTY options shows non-trivial brokerage', () => {
    const fee = simulateBrokerage('NFO', 25, 100, 'BUY') + simulateBrokerage('NFO', 25, 105, 'SELL');
    expect(fee).toBeGreaterThan(0);
    expect(fee).toBeLessThan(100); // sanity bound for one round trip on 1 lot @ ₹100
  });
});
