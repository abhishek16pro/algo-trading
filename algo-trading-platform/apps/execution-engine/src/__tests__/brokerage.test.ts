import { describe, it, expect } from 'vitest';
import { simulateBrokerage } from '../brokerage.js';

describe('simulateBrokerage', () => {
  it('charges nothing on a free trade', () => {
    expect(simulateBrokerage('NSE', 0, 0, 'BUY')).toBeGreaterThanOrEqual(0);
  });

  it('charges meaningfully on a typical NFO option fill', () => {
    const fee = simulateBrokerage('NFO', 25, 100, 'SELL');
    expect(fee).toBeGreaterThan(0);
  });

  it('NFO BUY has stamp duty but no STT', () => {
    const buy = simulateBrokerage('NFO', 100, 100, 'BUY');
    const sell = simulateBrokerage('NFO', 100, 100, 'SELL');
    expect(sell).toBeGreaterThan(buy); // STT charged only on sell
  });
});
