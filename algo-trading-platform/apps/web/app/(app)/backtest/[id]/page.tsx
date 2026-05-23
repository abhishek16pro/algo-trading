'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { api } from '@/lib/api';

export default function BacktestDetail() {
  const params = useParams();
  const id = params.id as string;
  const { data } = useQuery({
    queryKey: ['backtest', id],
    queryFn: async () => (await api.get(`/backtests/${id}`)).data,
    refetchInterval: (q) =>
      (q.state.data as { status?: string } | undefined)?.status === 'done' ? false : 2000,
  });

  if (!data) return <div>Loading…</div>;
  const r = data.results;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Backtest result</h1>
      <div className="text-sm text-ink-muted">
        {data.status} · {(data.progress * 100).toFixed(0)}%
      </div>

      {r && (
        <>
          <div className="grid grid-cols-5 gap-3">
            <Stat label="Total P&L" value={`₹${r.totalPnL.toFixed(0)}`} className={r.totalPnL >= 0 ? 'pnl-pos' : 'pnl-neg'} />
            <Stat label="Win rate" value={`${r.winRate.toFixed(1)}%`} />
            <Stat label="Trades" value={String(r.totalTrades)} />
            <Stat label="Sharpe" value={r.sharpe?.toFixed(2)} />
            <Stat label="Max DD" value={`${r.maxDrawdownPercent?.toFixed(2)}%`} />
          </div>

          <div className="card p-4">
            <h2 className="font-medium mb-2">Equity curve</h2>
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={r.equityCurve}>
                  <XAxis dataKey="t" hide />
                  <YAxis domain={['auto', 'auto']} stroke="#8b98a5" />
                  <Tooltip />
                  <Area type="monotone" dataKey="equity" stroke="#3a86ff" fill="#3a86ff33" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-medium mb-2">Drawdown</h2>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={r.equityCurve}>
                  <XAxis dataKey="t" hide />
                  <YAxis domain={['auto', 0]} stroke="#8b98a5" />
                  <Tooltip />
                  <Line type="monotone" dataKey="drawdown" stroke="#ef4444" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className={`text-lg font-medium ${className}`}>{value}</div>
    </div>
  );
}
