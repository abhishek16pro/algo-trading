'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function BacktestPage() {
  const qc = useQueryClient();
  const strategies = useQuery({
    queryKey: ['strategies'],
    queryFn: async () => (await api.get('/strategies')).data,
  });
  const backtests = useQuery({
    queryKey: ['backtests'],
    queryFn: async () => (await api.get('/backtests')).data,
    refetchInterval: 5000,
  });

  const [strategyId, setStrategyId] = useState<string>('');
  const [from, setFrom] = useState<string>('2024-01-01');
  const [to, setTo] = useState<string>('2024-12-31');
  const [tf, setTf] = useState<string>('5m');

  const enqueue = useMutation({
    mutationFn: async () =>
      (await api.post('/backtests', {
        strategyId,
        range: { from, to },
        timeframe: tf,
        initialCapital: 100_000,
        slippageBps: 2,
        commissionPerOrder: 20,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backtests'] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Backtest</h1>
      <div className="card p-4 space-y-3">
        <select
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          className="bg-bg border border-white/10 rounded-md px-3 py-2 w-full"
        >
          <option value="">Choose a strategy…</option>
          {strategies.data?.map((s: { _id: string; name: string }) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-3">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-bg border border-white/10 rounded-md px-3 py-2" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-bg border border-white/10 rounded-md px-3 py-2" />
          <select value={tf} onChange={(e) => setTf(e.target.value)} className="bg-bg border border-white/10 rounded-md px-3 py-2">
            {['1m', '5m', '15m', '1h', '1d'].map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </div>
        <button onClick={() => enqueue.mutate()} disabled={!strategyId} className="btn btn-primary">
          Run backtest
        </button>
      </div>
      <h2 className="font-medium">Recent runs</h2>
      <div className="space-y-2">
        {backtests.data?.map((b: { _id: string; status: string; progress: number; results?: { totalPnL?: number; winRate?: number } }) => (
          <Link key={b._id} href={`/backtest/${b._id}`} className="card p-3 flex justify-between hover:ring-1 hover:ring-brand block">
            <div>
              <div className="text-sm">#{b._id.slice(-6)}</div>
              <div className="text-xs text-ink-muted">{b.status} · {(b.progress * 100).toFixed(0)}%</div>
            </div>
            {b.results && (
              <div className="text-right text-sm">
                <div className={b.results.totalPnL && b.results.totalPnL >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                  ₹{b.results.totalPnL?.toFixed(0)}
                </div>
                <div className="text-xs text-ink-muted">{b.results.winRate?.toFixed(1)}% win</div>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
