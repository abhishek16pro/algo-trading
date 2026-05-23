'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY'] as const;
const STRATEGY_TYPES = [
  { id: 'time-based', label: 'Time-based (multi-leg)', segments: ['options', 'futures'] },
  { id: 'options-strangle', label: 'Options Strangle', segments: ['options'] },
  { id: 'options-straddle', label: 'Options Straddle', segments: ['options'] },
  { id: 'iron-condor', label: 'Iron Condor', segments: ['options'] },
  { id: 'signal-based', label: 'Signal-based', segments: ['index', 'futures', 'options'] },
] as const;

const STRIKE_SELECTIONS = ['ATM', 'OTM', 'ITM', 'closest-premium', 'delta-based'] as const;
const EXPIRY_PREF = ['current-week', 'next-week', 'monthly'] as const;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;

type Leg = {
  legId: string;
  action: 'BUY' | 'SELL';
  optionType: 'CE' | 'PE';
  strikeSelection: (typeof STRIKE_SELECTIONS)[number];
  strikeOffset: number;
  lots: number;
  expiry: (typeof EXPIRY_PREF)[number];
  slType?: 'percent' | 'points' | 'rupees';
  slValue?: number;
  tpType?: 'percent' | 'points' | 'rupees';
  tpValue?: number;
  reEntryEnabled?: boolean;
  reEntryMax?: number;
};

function newLeg(): Leg {
  return {
    legId: `leg-${Math.random().toString(36).slice(2, 8)}`,
    action: 'SELL',
    optionType: 'CE',
    strikeSelection: 'OTM',
    strikeOffset: 2,
    lots: 1,
    expiry: 'current-week',
    slType: 'percent',
    slValue: 30,
    tpType: 'percent',
    tpValue: 50,
  };
}

export default function NewStrategyPage() {
  const router = useRouter();
  const { data: brokers } = useQuery({
    queryKey: ['broker-accounts'],
    queryFn: async () => (await api.get('/brokers/accounts')).data,
  });
  const { data: availableSignals } = useQuery({
    queryKey: ['signals'],
    queryFn: async () => (await api.get('/signals')).data,
  });

  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof STRATEGY_TYPES)[number]['id']>('time-based');
  const [underlying, setUnderlying] = useState<(typeof UNDERLYINGS)[number]>('BANKNIFTY');
  const [segment, setSegment] = useState<'options' | 'futures' | 'index'>('options');
  const [entryTime, setEntryTime] = useState('09:20');
  const [exitTime, setExitTime] = useState('15:15');
  const [legs, setLegs] = useState<Leg[]>([newLeg(), { ...newLeg(), optionType: 'PE' }]);
  const [signalIds, setSignalIds] = useState<string[]>([]);
  const [signalCombinator, setSignalCombinator] = useState<'AND' | 'OR'>('AND');
  const [capital, setCapital] = useState(200000);
  const [maxLossDay, setMaxLossDay] = useState(5000);
  const [maxLossTrade, setMaxLossTrade] = useState(2000);
  const [maxPositions, setMaxPositions] = useState(4);
  const [lotMultiplier, setLotMultiplier] = useState(1);
  const [activeDays, setActiveDays] = useState<Array<(typeof DAYS)[number]>>(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  const [brokerAccountId, setBrokerAccountId] = useState<string>('');
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLeg(i: number, patch: Partial<Leg>) {
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLeg(i: number) {
    setLegs((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addLeg() {
    setLegs((prev) => [...prev, newLeg()]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name || `${underlying} ${type} ${new Date().toLocaleDateString()}`,
        description: `${type} on ${underlying}`,
        type,
        mode,
        brokerAccountId: brokerAccountId || undefined,
        underlying,
        segment,
        entry: {
          triggerType: type === 'signal-based' ? 'signal' : 'time',
          time: entryTime,
          signals:
            type === 'signal-based'
              ? signalIds.map((id) => ({ signalId: id, logic: signalCombinator }))
              : undefined,
          legs:
            segment === 'options'
              ? legs.map((l) => ({
                  legId: l.legId,
                  action: l.action,
                  optionType: l.optionType,
                  strikeSelection: l.strikeSelection,
                  strikeOffset: l.strikeOffset,
                  lots: l.lots,
                  expiry: l.expiry,
                  individualSL:
                    l.slType && l.slValue ? { type: l.slType, value: l.slValue } : undefined,
                  individualTP:
                    l.tpType && l.tpValue ? { type: l.tpType, value: l.tpValue } : undefined,
                }))
              : undefined,
        },
        exit: {
          timeExit: exitTime,
          reEntry: { enabled: false, maxAttempts: 0 },
        },
        risk: {
          capitalDeployed: capital,
          maxLossPerDay: maxLossDay,
          maxLossPerTrade: maxLossTrade,
          maxPositions,
          lotMultiplier,
        },
        schedule: {
          activeDays,
          startTime: '09:15',
          endTime: '15:30',
          timezone: 'Asia/Kolkata',
        },
      };
      const r = await api.post('/strategies', body);
      router.push(`/strategies/${r.data.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; details?: unknown } } };
      const msg = err.response?.data?.message ?? 'Save failed';
      const details = err.response?.data?.details ? JSON.stringify(err.response.data.details) : '';
      setError(`${msg}${details ? ' — ' + details : ''}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold">New strategy</h1>

      {/* Section 1 — basics */}
      <Section title="Basics">
        <Row label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. BANKNIFTY 9:20 strangle"
            className="input"
          />
        </Row>
        <Row label="Strategy type">
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="input">
            {STRATEGY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Underlying">
          <select value={underlying} onChange={(e) => setUnderlying(e.target.value as typeof underlying)} className="input">
            {UNDERLYINGS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Row>
        <Row label="Segment">
          <select value={segment} onChange={(e) => setSegment(e.target.value as typeof segment)} className="input">
            <option value="options">Options</option>
            <option value="futures">Futures</option>
            <option value="index">Index</option>
          </select>
        </Row>
        <Row label="Broker account">
          <select
            value={brokerAccountId}
            onChange={(e) => setBrokerAccountId(e.target.value)}
            className="input"
          >
            <option value="">(paper mode — no broker needed)</option>
            {brokers?.map((b: { id: string; label: string; broker: string }) => (
              <option key={b.id} value={b.id}>
                {b.label} ({b.broker})
              </option>
            ))}
          </select>
        </Row>
        <Row label="Mode">
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="input">
            <option value="paper">Paper</option>
            <option value="live">Live</option>
          </select>
        </Row>
      </Section>

      {/* Section 2a — signals (only for signal-based strategies) */}
      {type === 'signal-based' && (
        <Section
          title="Entry signals"
          action={
            <a href="/signals/new" target="_blank" className="btn btn-ghost border border-white/10 text-xs">
              + Create signal
            </a>
          }
        >
          <p className="text-xs text-ink-muted">
            Pick one or more saved signals. Combine them with AND/OR. Entry fires when the
            combination is satisfied (signals stay valid for 60 seconds after firing).
          </p>
          <Row label="Combinator">
            <select
              value={signalCombinator}
              onChange={(e) => setSignalCombinator(e.target.value as 'AND' | 'OR')}
              className="input"
            >
              <option value="AND">AND (all must fire)</option>
              <option value="OR">OR (any one fires)</option>
            </select>
          </Row>
          {!availableSignals || availableSignals.length === 0 ? (
            <div className="text-sm text-ink-muted">
              No signals saved yet. <a href="/signals/new" className="text-brand">Create one</a> first.
            </div>
          ) : (
            <div className="space-y-1">
              {availableSignals.map((s: { _id: string; name: string; indicator: string; timeframe: string }) => {
                const checked = signalIds.includes(s._id);
                return (
                  <label
                    key={s._id}
                    className={`flex items-center gap-3 p-2 rounded cursor-pointer ${
                      checked ? 'bg-brand/10 border border-brand/30' : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSignalIds(e.target.checked
                          ? [...signalIds, s._id]
                          : signalIds.filter((x) => x !== s._id))
                      }
                    />
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-ink-muted">{s.indicator} · {s.timeframe}</span>
                  </label>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {/* Section 2 — timing */}
      {type !== 'signal-based' && (
        <Section title="Timing">
          <Row label="Entry time (IST)">
            <input
              type="time"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
              className="input"
            />
          </Row>
          <Row label="Square-off time (IST)">
            <input
              type="time"
              value={exitTime}
              onChange={(e) => setExitTime(e.target.value)}
              className="input"
            />
          </Row>
          <Row label="Active days">
            <div className="flex gap-2">
              {DAYS.map((d) => {
                const on = activeDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setActiveDays(on ? activeDays.filter((x) => x !== d) : [...activeDays, d])}
                    className={`px-2 py-1 rounded text-xs ${on ? 'bg-brand text-white' : 'bg-white/5 text-ink-muted'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Row>
        </Section>
      )}

      {/* Section 3 — legs (options only) */}
      {segment === 'options' && (
        <Section
          title="Option legs"
          action={
            <button onClick={addLeg} className="btn btn-ghost border border-white/10 text-xs">
              + Add leg
            </button>
          }
        >
          {legs.length === 0 && (
            <div className="text-ink-muted text-sm">No legs yet — click <strong>Add leg</strong>.</div>
          )}
          <div className="space-y-3">
            {legs.map((l, i) => (
              <div key={l.legId} className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Cell label="Action">
                  <select value={l.action} onChange={(e) => updateLeg(i, { action: e.target.value as 'BUY' | 'SELL' })} className="input">
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </Cell>
                <Cell label="Option">
                  <select value={l.optionType} onChange={(e) => updateLeg(i, { optionType: e.target.value as 'CE' | 'PE' })} className="input">
                    <option value="CE">CE (Call)</option>
                    <option value="PE">PE (Put)</option>
                  </select>
                </Cell>
                <Cell label="Strike">
                  <select value={l.strikeSelection} onChange={(e) => updateLeg(i, { strikeSelection: e.target.value as Leg['strikeSelection'] })} className="input">
                    {STRIKE_SELECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Cell>
                <Cell label="Offset">
                  <input type="number" value={l.strikeOffset} onChange={(e) => updateLeg(i, { strikeOffset: Number(e.target.value) })} className="input" />
                </Cell>
                <Cell label="Lots">
                  <input type="number" min={1} value={l.lots} onChange={(e) => updateLeg(i, { lots: Number(e.target.value) })} className="input" />
                </Cell>
                <Cell label="Expiry">
                  <select value={l.expiry} onChange={(e) => updateLeg(i, { expiry: e.target.value as Leg['expiry'] })} className="input">
                    {EXPIRY_PREF.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Cell>
                <Cell label="SL (per-leg)">
                  <div className="flex gap-1">
                    <select value={l.slType ?? ''} onChange={(e) => updateLeg(i, { slType: (e.target.value || undefined) as Leg['slType'] })} className="input flex-1">
                      <option value="">none</option>
                      <option value="percent">%</option>
                      <option value="points">pts</option>
                      <option value="rupees">₹</option>
                    </select>
                    <input type="number" placeholder="30" value={l.slValue ?? ''} onChange={(e) => updateLeg(i, { slValue: Number(e.target.value) })} className="input w-20" />
                  </div>
                </Cell>
                <Cell label="TP (per-leg)">
                  <div className="flex gap-1">
                    <select value={l.tpType ?? ''} onChange={(e) => updateLeg(i, { tpType: (e.target.value || undefined) as Leg['tpType'] })} className="input flex-1">
                      <option value="">none</option>
                      <option value="percent">%</option>
                      <option value="points">pts</option>
                      <option value="rupees">₹</option>
                    </select>
                    <input type="number" placeholder="50" value={l.tpValue ?? ''} onChange={(e) => updateLeg(i, { tpValue: Number(e.target.value) })} className="input w-20" />
                  </div>
                </Cell>
                <div className="col-span-full flex justify-between items-center pt-2 border-t border-white/5">
                  <span className="text-xs text-ink-muted">{l.legId}</span>
                  <button onClick={() => removeLeg(i)} className="btn btn-ghost text-neg text-xs">
                    Remove leg
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Section 4 — risk */}
      <Section title="Risk">
        <Row label="Capital deployed (₹)">
          <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="input" />
        </Row>
        <Row label="Max loss / day (₹)">
          <input type="number" value={maxLossDay} onChange={(e) => setMaxLossDay(Number(e.target.value))} className="input" />
        </Row>
        <Row label="Max loss / trade (₹)">
          <input type="number" value={maxLossTrade} onChange={(e) => setMaxLossTrade(Number(e.target.value))} className="input" />
        </Row>
        <Row label="Max open positions">
          <input type="number" value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value))} className="input" />
        </Row>
        <Row label="Lot multiplier">
          <input type="number" value={lotMultiplier} onChange={(e) => setLotMultiplier(Number(e.target.value))} className="input" />
        </Row>
      </Section>

      {error && <div className="card p-3 text-neg text-sm">{error}</div>}

      <div className="flex gap-3">
        <button onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save strategy'}
        </button>
        <button onClick={() => router.back()} className="btn btn-ghost">Cancel</button>
      </div>

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
        :global(.input:focus) {
          outline: none;
          border-color: #3a86ff;
        }
      `}</style>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-medium">{title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
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

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
