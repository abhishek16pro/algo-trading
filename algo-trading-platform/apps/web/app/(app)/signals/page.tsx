'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Signal = {
  _id: string;
  name: string;
  description?: string;
  indicator: string;
  params?: Record<string, number>;
  condition: string;
  compareTo?: { type: string; value?: number; indicator?: string; params?: Record<string, number>; source?: string };
  timeframe: string;
  isPublic?: boolean;
};

export default function SignalsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['signals'],
    queryFn: async () => (await api.get('/signals')).data as Signal[],
  });
  const del = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/signals/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signals'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Signals</h1>
        <Link href="/signals/new" className="btn btn-primary">+ New signal</Link>
      </div>

      <p className="text-sm text-ink-muted">
        Signals are reusable building blocks. Combine them with AND/OR in a strategy&apos;s entry trigger.
      </p>

      {isLoading && <div className="text-ink-muted">Loading…</div>}
      {data?.length === 0 && (
        <div className="card p-8 text-center text-ink-muted">
          No signals yet. <Link href="/signals/new" className="text-brand">Create one</Link>.
        </div>
      )}

      <div className="space-y-2">
        {data?.map((s) => (
          <div key={s._id} className="card p-4 flex justify-between items-start">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-ink-muted mt-0.5">{renderExpression(s)}</div>
              <div className="text-xs text-ink-muted mt-0.5">timeframe: {s.timeframe}</div>
            </div>
            <button onClick={() => del.mutate(s._id)} className="btn btn-ghost text-neg text-xs">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderExpression(s: Signal): string {
  const left = `${s.indicator}${formatParams(s.params)}`;
  let right = '?';
  if (s.compareTo?.type === 'value') right = String(s.compareTo.value);
  else if (s.compareTo?.type === 'indicator') right = `${s.compareTo.indicator}${formatParams(s.compareTo.params)}`;
  else if (s.compareTo?.type === 'price') right = `price.${s.compareTo.source}`;
  return `${left} ${s.condition} ${right}`;
}

function formatParams(p: Record<string, number> | undefined): string {
  if (!p) return '';
  const entries = Object.entries(p).filter(([_, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return '(' + entries.map(([k, v]) => `${k}=${v}`).join(', ') + ')';
}
