'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function OrdersPage() {
  const { data } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get('/orders?limit=100')).data,
    refetchInterval: 3000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted bg-white/5">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Mode</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((o: { _id: string; placedAt: string; tradingsymbol: string; side: string; orderType: string; quantity: number; averagePrice: number; status: string; mode: string }) => (
              <tr key={o._id} className="border-t border-white/5">
                <td className="px-3 py-2 text-ink-muted">{new Date(o.placedAt).toLocaleTimeString()}</td>
                <td className="px-3 py-2 font-medium">{o.tradingsymbol}</td>
                <td className={`px-3 py-2 ${o.side === 'BUY' ? 'pnl-pos' : 'pnl-neg'}`}>{o.side}</td>
                <td className="px-3 py-2">{o.orderType}</td>
                <td className="px-3 py-2 text-right">{o.quantity}</td>
                <td className="px-3 py-2 text-right">{o.averagePrice?.toFixed(2)}</td>
                <td className="px-3 py-2">{o.status}</td>
                <td className="px-3 py-2 text-ink-muted">{o.mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
