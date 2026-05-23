'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function StrategiesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: async () => (await api.get('/strategies')).data,
  });

  const deploy = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: 'live' | 'paper' }) =>
      (await api.post(`/strategies/${id}/deploy`, { mode })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategies'] }),
  });
  const stop = useMutation({
    mutationFn: async (id: string) => (await api.post(`/strategies/${id}/stop`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategies'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Strategies</h1>
        <Link href="/strategies/new" className="btn btn-primary">
          + New strategy
        </Link>
      </div>
      {isLoading ? (
        <div className="text-ink-muted">Loading…</div>
      ) : data?.length === 0 ? (
        <div className="card p-8 text-center text-ink-muted">
          No strategies yet. Click <strong>New strategy</strong> to start.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {data?.map((s: {
            _id: string; name: string; type: string; underlying: string;
            mode: string; state: string;
          }) => (
            <div key={s._id} className="card p-4 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <Link href={`/strategies/${s._id}`} className="font-medium hover:text-brand">
                    {s.name}
                  </Link>
                  <div className="text-xs text-ink-muted">
                    {s.type} · {s.underlying}
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-white/5">
                  {s.mode} · {s.state}
                </span>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  className="btn btn-ghost border border-white/10"
                  onClick={() => deploy.mutate({ id: s._id, mode: 'paper' })}
                >
                  Deploy paper
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => deploy.mutate({ id: s._id, mode: 'live' })}
                >
                  Deploy live
                </button>
                {s.state === 'running' && (
                  <button className="btn btn-ghost" onClick={() => stop.mutate(s._id)}>
                    Stop
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
