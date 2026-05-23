'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

export default function StrategyDetail() {
  const params = useParams();
  const id = params.id as string;
  const { data, isLoading } = useQuery({
    queryKey: ['strategy', id],
    queryFn: async () => (await api.get(`/strategies/${id}`)).data,
  });

  if (isLoading) return <div className="text-ink-muted">Loading…</div>;
  if (!data) return <div className="text-neg">Not found</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{data.name}</h1>
      <div className="text-ink-muted text-sm">{data.description}</div>

      <div className="card p-4">
        <h2 className="font-medium mb-2">Configuration</h2>
        <pre className="text-xs overflow-x-auto bg-bg p-3 rounded">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}
