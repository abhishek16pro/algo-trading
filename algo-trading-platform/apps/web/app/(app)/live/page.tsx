'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';

type Position = {
  _id: string;
  tradingsymbol: string;
  netQty: number;
  avgPrice: number;
  lastPrice: number;
  pnl: number;
};

export default function LivePage() {
  const positions = useQuery({
    queryKey: ['positions', 'live'],
    queryFn: async () => (await api.get('/positions?mode=live')).data as Position[],
    refetchInterval: 5000,
  });

  const socket = useSocket();
  const [ticks, setTicks] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!socket) return;
    const handler = (t: { instrumentToken: string; ltp: number }) =>
      setTicks((s) => ({ ...s, [t.instrumentToken]: t.ltp }));
    socket.on('tick', handler);
    return () => {
      socket.off('tick', handler);
    };
  }, [socket]);

  const totalPnl = positions.data?.reduce((s, p) => s + (p.pnl ?? 0), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Live trading</h1>
        <div className={`text-lg font-semibold ${totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
          P&L: ₹{totalPnl.toFixed(2)}
        </div>
      </div>
      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted bg-white/5">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Avg</th>
              <th className="px-3 py-2 text-right">LTP</th>
              <th className="px-3 py-2 text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {positions.data?.map((p) => {
              const live = ticks[p._id] ?? p.lastPrice;
              return (
                <tr key={p._id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-medium">{p.tradingsymbol}</td>
                  <td className="px-3 py-2 text-right">{p.netQty}</td>
                  <td className="px-3 py-2 text-right">{p.avgPrice.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{live?.toFixed(2)}</td>
                  <td className={`px-3 py-2 text-right ${p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                    ₹{p.pnl.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {positions.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-ink-muted py-8">
                  No live positions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
