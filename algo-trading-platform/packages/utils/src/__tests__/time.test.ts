import { describe, it, expect } from 'vitest';
import { toISTHHmm, parseHHmm, floorToTimeframe, addMinutes } from '../time.js';

describe('time', () => {
  it('formats UTC midnight as 05:30 IST', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    expect(toISTHHmm(d)).toBe('05:30');
  });

  it('formats 09:15 IST equivalent (03:45 UTC) correctly', () => {
    const d = new Date('2024-01-01T03:45:00Z');
    expect(toISTHHmm(d)).toBe('09:15');
  });

  it('parses HH:mm', () => {
    expect(parseHHmm('09:15')).toEqual({ hh: 9, mm: 15 });
    expect(() => parseHHmm('25:00')).toThrow();
    expect(() => parseHHmm('9:15')).toThrow();
  });

  it('floors to timeframe', () => {
    const d = new Date('2024-01-01T03:47:30Z');
    const floored = floorToTimeframe(d, 5);
    expect(floored.toISOString()).toBe('2024-01-01T03:45:00.000Z');
  });

  it('adds minutes', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    expect(addMinutes(d, 15).toISOString()).toBe('2024-01-01T00:15:00.000Z');
  });
});
