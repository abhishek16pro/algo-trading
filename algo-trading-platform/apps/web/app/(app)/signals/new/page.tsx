'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const INDICATORS = [
  { id: 'SMA', label: 'Simple MA', params: ['period'] },
  { id: 'EMA', label: 'Exponential MA', params: ['period'] },
  { id: 'WMA', label: 'Weighted MA', params: ['period'] },
  { id: 'RSI', label: 'RSI (Wilder)', params: ['period'] },
  { id: 'MACD', label: 'MACD', params: ['fastPeriod', 'slowPeriod', 'signalPeriod'] },
  { id: 'BOLLINGER', label: 'Bollinger Bands', params: ['period', 'stdDev'] },
  { id: 'ATR', label: 'ATR', params: ['period'] },
  { id: 'SUPERTREND', label: 'Supertrend', params: ['period', 'multiplier'] },
  { id: 'VWAP', label: 'VWAP (session)', params: [] },
  { id: 'ADX', label: 'ADX / DI+ / DI-', params: ['period'] },
  { id: 'STOCH', label: 'Stochastic', params: ['period'] },
  { id: 'PRICE', label: 'Price', params: [] },
] as const;

const CONDITIONS = [
  { id: 'crosses-above', label: 'crosses above' },
  { id: 'crosses-below', label: 'crosses below' },
  { id: 'greater-than', label: 'greater than' },
  { id: 'less-than', label: 'less than' },
  { id: 'equal-to', label: 'equal to' },
] as const;

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '1d'] as const;

const PRICE_SOURCES = ['open', 'high', 'low', 'close'] as const;

const TEMPLATES = [
  {
    label: 'EMA20 crosses above EMA50',
    indicator: 'EMA' as const,
    params: { period: 20 },
    condition: 'crosses-above' as const,
    compareTo: { type: 'indicator', indicator: 'EMA', params: { period: 50 } } as Record<string, unknown>,
    timeframe: '5m' as const,
  },
  {
    label: 'RSI(14) > 60 (bullish momentum)',
    indicator: 'RSI' as const,
    params: { period: 14 },
    condition: 'greater-than' as const,
    compareTo: { type: 'value', value: 60 } as Record<string, unknown>,
    timeframe: '5m' as const,
  },
  {
    label: 'Supertrend(10,3) flips up',
    indicator: 'SUPERTREND' as const,
    params: { period: 10, multiplier: 3 },
    condition: 'less-than' as const,
    compareTo: { type: 'price', source: 'close' } as Record<string, unknown>,
    timeframe: '5m' as const,
  },
  {
    label: 'Price > VWAP',
    indicator: 'PRICE' as const,
    params: {},
    condition: 'greater-than' as const,
    compareTo: { type: 'indicator', indicator: 'VWAP', params: {} } as Record<string, unknown>,
    timeframe: '5m' as const,
  },
];

export default function NewSignalPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [indicator, setIndicator] = useState<(typeof INDICATORS)[number]['id']>('EMA');
  const [params, setParams] = useState<Record<string, number>>({ period: 20 });
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]['id']>('crosses-above');
  const [compareType, setCompareType] = useState<'value' | 'indicator' | 'price'>('indicator');
  const [compareValue, setCompareValue] = useState<number>(50);
  const [compareIndicator, setCompareIndicator] = useState<(typeof INDICATORS)[number]['id']>('EMA');
  const [compareParams, setCompareParams] = useState<Record<string, number>>({ period: 50 });
  const [comparePriceSource, setComparePriceSource] = useState<(typeof PRICE_SOURCES)[number]>('close');
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>('5m');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    setName(t.label);
    setIndicator(t.indicator);
    setParams((t.params as Record<string, number>) ?? {});
    setCondition(t.condition);
    const ct = t.compareTo;
    setCompareType((ct.type as 'value' | 'indicator' | 'price') ?? 'value');
    if (ct.type === 'value') setCompareValue(Number(ct.value ?? 0));
    if (ct.type === 'indicator') {
      setCompareIndicator(ct.indicator as typeof compareIndicator);
      setCompareParams((ct.params as Record<string, number>) ?? {});
    }
    if (ct.type === 'price') setComparePriceSource(ct.source as typeof comparePriceSource);
    setTimeframe(t.timeframe);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      let compareTo: Record<string, unknown>;
      if (compareType === 'value') compareTo = { type: 'value', value: compareValue };
      else if (compareType === 'indicator')
        compareTo = { type: 'indicator', indicator: compareIndicator, params: compareParams };
      else compareTo = { type: 'price', source: comparePriceSource };

      const body = {
        name: name || `${indicator} ${condition}`,
        description,
        indicator,
        params,
        condition,
        compareTo,
        timeframe,
      };
      const r = await api.post('/signals', body);
      router.push(`/signals?created=${r.data.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; details?: unknown } } };
      setError(err.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const indicatorParams = INDICATORS.find((i) => i.id === indicator)?.params ?? [];
  const compareIndicatorParams = INDICATORS.find((i) => i.id === compareIndicator)?.params ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">New signal</h1>

      <section className="card p-4 space-y-3">
        <h2 className="font-medium">Templates (click to fill the form)</h2>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => applyTemplate(t)}
              className="text-left text-sm card p-3 hover:ring-1 hover:ring-brand"
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-medium">Definition</h2>

        <Row label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. EMA20 crosses EMA50 on 5m" />
        </Row>
        <Row label="Description (optional)">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
        </Row>
        <Row label="Timeframe">
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as typeof timeframe)} className="input">
            {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </Row>

        <div className="card p-3 bg-bg space-y-3">
          <h3 className="text-xs uppercase text-ink-muted">Left side (indicator)</h3>
          <Row label="Indicator">
            <select value={indicator} onChange={(e) => { setIndicator(e.target.value as typeof indicator); setParams({}); }} className="input">
              {INDICATORS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </Row>
          {indicatorParams.map((p) => (
            <Row key={p} label={p}>
              <input
                type="number"
                value={params[p] ?? ''}
                onChange={(e) => setParams({ ...params, [p]: Number(e.target.value) })}
                className="input"
              />
            </Row>
          ))}
        </div>

        <Row label="Condition">
          <select value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)} className="input">
            {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Row>

        <div className="card p-3 bg-bg space-y-3">
          <h3 className="text-xs uppercase text-ink-muted">Right side (compare to)</h3>
          <Row label="Type">
            <select value={compareType} onChange={(e) => setCompareType(e.target.value as typeof compareType)} className="input">
              <option value="value">Fixed value</option>
              <option value="indicator">Another indicator</option>
              <option value="price">Price (OHLC)</option>
            </select>
          </Row>
          {compareType === 'value' && (
            <Row label="Value">
              <input type="number" value={compareValue} onChange={(e) => setCompareValue(Number(e.target.value))} className="input" />
            </Row>
          )}
          {compareType === 'indicator' && (
            <>
              <Row label="Indicator">
                <select
                  value={compareIndicator}
                  onChange={(e) => { setCompareIndicator(e.target.value as typeof compareIndicator); setCompareParams({}); }}
                  className="input"
                >
                  {INDICATORS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              </Row>
              {compareIndicatorParams.map((p) => (
                <Row key={p} label={p}>
                  <input
                    type="number"
                    value={compareParams[p] ?? ''}
                    onChange={(e) => setCompareParams({ ...compareParams, [p]: Number(e.target.value) })}
                    className="input"
                  />
                </Row>
              ))}
            </>
          )}
          {compareType === 'price' && (
            <Row label="Price source">
              <select value={comparePriceSource} onChange={(e) => setComparePriceSource(e.target.value as typeof comparePriceSource)} className="input">
                {PRICE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Row>
          )}
        </div>

        {error && <div className="text-neg text-sm">{error}</div>}

        <div className="flex gap-3">
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save signal'}
          </button>
          <button onClick={() => router.back()} className="btn btn-ghost">Cancel</button>
        </div>
      </section>

      <style jsx>{`
        :global(.input) {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          color: inherit;
          font-size: 0.875rem;
          width: 100%;
        }
        :global(.input:focus) { outline: none; border-color: #3a86ff; }
      `}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[200px_1fr] gap-3 items-center">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
