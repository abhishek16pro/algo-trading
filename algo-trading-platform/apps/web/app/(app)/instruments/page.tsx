'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function InstrumentsPage() {
  const [q, setQ] = useState('NIFTY');
  const { data } = useQuery({
    queryKey: ['instruments', q],
    queryFn: async () => (await api.get(`/instruments/search?q=${encodeURIComponent(q)}`)).data,
    enabled: q.length >= 2,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Instruments</h1>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by symbol (e.g. NIFTY, BANKNIFTY24OCT…)"
        className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
      />
      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted bg-white/5">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Exchange</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Strike</th>
              <th className="px-3 py-2 text-right">Lot</th>
              <th className="px-3 py-2">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((i: { _id: string; tradingsymbol: string; exchange: string; instrumentType: string; strike?: number; lotSize: number; expiry?: string }) => (
              <tr key={i._id} className="border-t border-white/5">
                <td className="px-3 py-2">{i.tradingsymbol}</td>
                <td className="px-3 py-2 text-ink-muted">{i.exchange}</td>
                <td className="px-3 py-2">{i.instrumentType}</td>
                <td className="px-3 py-2 text-right">{i.strike?.toFixed(0) ?? '—'}</td>
                <td className="px-3 py-2 text-right">{i.lotSize}</td>
                <td className="px-3 py-2">{i.expiry ? new Date(i.expiry).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
