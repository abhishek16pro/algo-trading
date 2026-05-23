'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const SUPPORTED = ['mock', 'zerodha', 'angelone', 'upstox', 'dhan', 'fyers'] as const;

export default function BrokersPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['broker-accounts'],
    queryFn: async () => (await api.get('/brokers/accounts')).data,
  });

  const [form, setForm] = useState({
    broker: 'mock' as (typeof SUPPORTED)[number],
    label: '',
    apiKey: '',
    apiSecret: '',
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/brokers/accounts', {
        broker: form.broker,
        label: form.label || `${form.broker} account`,
        credentials: { apiKey: form.apiKey, apiSecret: form.apiSecret },
      })).data,
    onSuccess: () => {
      setForm({ broker: 'mock', label: '', apiKey: '', apiSecret: '' });
      qc.invalidateQueries({ queryKey: ['broker-accounts'] });
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Broker accounts</h1>
      <div className="card p-4 space-y-3">
        <h2 className="font-medium">Connect a broker</h2>
        <select
          value={form.broker}
          onChange={(e) => setForm({ ...form, broker: e.target.value as (typeof SUPPORTED)[number] })}
          className="bg-bg border border-white/10 rounded-md px-3 py-2"
        >
          {SUPPORTED.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <input
          placeholder="Label"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
        />
        <input
          placeholder="API key"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
        />
        <input
          placeholder="API secret"
          type="password"
          value={form.apiSecret}
          onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
        />
        <button onClick={() => create.mutate()} className="btn btn-primary">
          Connect
        </button>
      </div>
      <div className="space-y-2">
        {data?.map((a: { id: string; broker: string; label: string; isActive: boolean }) => (
          <div key={a.id} className="card p-4 flex justify-between">
            <div>
              <div className="font-medium">{a.label}</div>
              <div className="text-xs text-ink-muted">{a.broker}</div>
            </div>
            <div className="text-xs">{a.isActive ? '🟢 active' : '⚪ inactive'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
