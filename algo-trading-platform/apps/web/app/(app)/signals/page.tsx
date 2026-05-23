'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function SignalsPage() {
  const { data } = useQuery({
    queryKey: ['signals'],
    queryFn: async () => (await api.get('/signals')).data,
  });
  const templates = useQuery({
    queryKey: ['signal-templates'],
    queryFn: async () => (await api.get('/signals/templates')).data,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Signals</h1>
      <div className="card p-4">
        <h2 className="font-medium mb-2">My signals</h2>
        {data?.length === 0 ? (
          <div className="text-sm text-ink-muted">No saved signals yet.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {data?.map((s: { _id: string; name: string; indicator: string; timeframe: string }) => (
              <li key={s._id} className="border-t border-white/5 py-2">
                <span className="font-medium">{s.name}</span>{' '}
                <span className="text-ink-muted">{s.indicator} · {s.timeframe}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card p-4">
        <h2 className="font-medium mb-2">Templates</h2>
        <ul className="space-y-2 text-sm">
          {templates.data?.map((t: { name: string; indicator: string; timeframe: string }) => (
            <li key={t.name} className="border-t border-white/5 py-2">
              <span className="font-medium">{t.name}</span>{' '}
              <span className="text-ink-muted">{t.indicator} · {t.timeframe}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
