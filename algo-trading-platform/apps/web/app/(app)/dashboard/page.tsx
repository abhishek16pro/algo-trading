'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const strategies = useQuery({
    queryKey: ['strategies'],
    queryFn: async () => (await api.get('/strategies')).data,
  });
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: async () => (await api.get('/positions')).data,
  });

  const pnl =
    positions.data?.reduce((s: number, p: { pnl?: number }) => s + (p.pnl ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-4 gap-4">
        <Tile label="Strategies" value={strategies.data?.length ?? 0} />
        <Tile label="Open positions" value={positions.data?.length ?? 0} />
        <Tile
          label="Today P&L"
          value={`₹${pnl.toFixed(2)}`}
          className={pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}
        />
        <Tile label="Status" value="connected" />
      </div>
      <div className="card p-4">
        <h2 className="font-medium mb-2">Active strategies</h2>
        {strategies.data?.length === 0 ? (
          <div className="text-ink-muted text-sm">
            No strategies yet. <a href="/strategies/new" className="text-brand">Create one</a>.
          </div>
        ) : (
          <ul className="space-y-2">
            {strategies.data?.map((s: { _id: string; name: string; mode: string; state: string }) => (
              <li key={s._id} className="flex justify-between text-sm">
                <span>{s.name}</span>
                <span className="text-ink-muted">
                  {s.mode} · {s.state}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="card p-4">
      <div className="text-ink-muted text-xs uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${className}`}>{value}</div>
    </div>
  );
}
