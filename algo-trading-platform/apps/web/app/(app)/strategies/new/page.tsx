'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const TEMPLATES = [
  {
    id: 'time-strangle',
    name: 'Time-based Options Strangle',
    type: 'options-strangle',
    description: 'Sell OTM CE + OTM PE at 09:20 IST, square off at 15:15.',
    underlying: 'BANKNIFTY',
    segment: 'options',
    legs: [
      { legId: 'ce', action: 'SELL', optionType: 'CE', strikeSelection: 'OTM', strikeOffset: 2, lots: 1 },
      { legId: 'pe', action: 'SELL', optionType: 'PE', strikeSelection: 'OTM', strikeOffset: 2, lots: 1 },
    ],
    entry: { triggerType: 'time', time: '09:20' },
    exit: { stopLoss: { type: 'percent', value: 30 }, timeExit: '15:15' },
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    type: 'iron-condor',
    description: 'Sell ATM strangle + buy further OTM wings for limited risk.',
    underlying: 'NIFTY',
    segment: 'options',
    legs: [
      { legId: 'sell-ce', action: 'SELL', optionType: 'CE', strikeSelection: 'OTM', strikeOffset: 1, lots: 1 },
      { legId: 'sell-pe', action: 'SELL', optionType: 'PE', strikeSelection: 'OTM', strikeOffset: 1, lots: 1 },
      { legId: 'buy-ce', action: 'BUY', optionType: 'CE', strikeSelection: 'OTM', strikeOffset: 3, lots: 1 },
      { legId: 'buy-pe', action: 'BUY', optionType: 'PE', strikeSelection: 'OTM', strikeOffset: 3, lots: 1 },
    ],
    entry: { triggerType: 'time', time: '09:20' },
    exit: { stopLoss: { type: 'percent', value: 40 }, timeExit: '15:15' },
  },
  {
    id: 'signal-rsi',
    name: 'Signal-based intraday',
    type: 'signal-based',
    description: 'Long NIFTY FUT when 5m RSI(14) > 60 and EMA20 > EMA50; SL 0.5%, TP 1%.',
    underlying: 'NIFTY',
    segment: 'futures',
    entry: { triggerType: 'signal' },
    exit: { stopLoss: { type: 'percent', value: 0.5 }, target: { type: 'percent', value: 1 } },
  },
];

type TemplateId = (typeof TEMPLATES)[number]['id'];

export default function NewStrategyPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<TemplateId>('time-strangle');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    const t = TEMPLATES.find((x) => x.id === selected)!;
    setLoading(true);
    try {
      const body = {
        name: name || t.name,
        description: t.description,
        type: t.type,
        underlying: t.underlying,
        segment: t.segment,
        entry: t.entry,
        exit: t.exit,
        risk: {
          capitalDeployed: 100_000,
          maxLossPerDay: 5_000,
          maxLossPerTrade: 2_000,
          maxPositions: 4,
          lotMultiplier: 1,
        },
        schedule: { activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] },
      };
      const r = await api.post('/strategies', body);
      router.push(`/strategies/${r.data.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Create strategy</h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Strategy name"
        className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
      />
      <div className="grid grid-cols-3 gap-4">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={`card p-4 text-left ${selected === t.id ? 'ring-2 ring-brand' : ''}`}
          >
            <div className="font-medium">{t.name}</div>
            <div className="text-xs text-ink-muted mt-1">{t.description}</div>
            <div className="text-xs text-ink-muted mt-2">{t.underlying} · {t.segment}</div>
          </button>
        ))}
      </div>
      <button className="btn btn-primary" onClick={create} disabled={loading}>
        {loading ? 'Creating…' : 'Create from template'}
      </button>
    </div>
  );
}
