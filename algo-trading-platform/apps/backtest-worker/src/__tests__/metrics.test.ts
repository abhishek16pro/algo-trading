import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../metrics.js';

describe('computeMetrics', () => {
  it('returns zeroed metrics for empty input', () => {
    const m = computeMetrics(100_000, [], []);
    expect(m.totalPnL).toBe(0);
    expect(m.totalTrades).toBe(0);
  });

  it('computes win rate, profit factor, and drawdown correctly', () => {
    const equity = [
      { t: new Date('2024-01-01'), equity: 100_000, drawdown: 0 },
      { t: new Date('2024-01-02'), equity: 105_000, drawdown: 0 },
      { t: new Date('2024-01-03'), equity: 95_000, drawdown: -9.52 },
      { t: new Date('2024-01-04'), equity: 110_000, drawdown: 0 },
    ];
    const trades = [
      { entryTime: new Date('2024-01-01'), exitTime: new Date('2024-01-02'), tradingsymbol: 'X', side: 'BUY' as const, quantity: 1, entryPrice: 100, pnl: 5000, pnlPercent: 5, brokerage: 0 },
      { entryTime: new Date('2024-01-02'), exitTime: new Date('2024-01-03'), tradingsymbol: 'X', side: 'BUY' as const, quantity: 1, entryPrice: 100, pnl: -10000, pnlPercent: -9.52, brokerage: 0 },
      { entryTime: new Date('2024-01-03'), exitTime: new Date('2024-01-04'), tradingsymbol: 'X', side: 'BUY' as const, quantity: 1, entryPrice: 100, pnl: 15000, pnlPercent: 15.78, brokerage: 0 },
    ];
    const m = computeMetrics(100_000, equity, trades);
    expect(m.totalPnL).toBe(10_000);
    expect(m.totalTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(66.67, 1);
    expect(m.profitFactor).toBeCloseTo(2, 1);
    expect(m.maxDrawdownPercent).toBeGreaterThan(9);
    expect(m.maxDrawdownPercent).toBeLessThan(11);
  });
});
