'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Position = {
  _id: string;
  tradingsymbol: string;
  netQty: number;
  avgPrice: number;
  lastPrice: number;
  pnl: number;
};

export default function PaperPage() {
  const positions = useQuery({
    queryKey: ['positions', 'paper'],
    queryFn: async () => (await api.get('/positions?mode=paper')).data as Position[],
    refetchInterval: 3000,
  });
  const orders = useQuery({
    queryKey: ['orders', 'paper'],
    queryFn: async () => (await api.get('/orders?limit=20')).data,
    refetchInterval: 3000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Paper trading</h1>
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-medium mb-2">Open positions</h2>
          <table className="w-full text-sm">
            <tbody>
              {positions.data?.map((p) => (
                <tr key={p._id} className="border-t border-white/5">
                  <td className="py-1">{p.tradingsymbol}</td>
                  <td className="py-1 text-right">{p.netQty}</td>
                  <td className={`py-1 text-right ${p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                    ₹{p.pnl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card p-4">
          <h2 className="font-medium mb-2">Recent orders</h2>
          <table className="w-full text-sm">
            <tbody>
              {orders.data?.map((o: { _id: string; tradingsymbol: string; side: string; quantity: number; status: string }) => (
                <tr key={o._id} className="border-t border-white/5">
                  <td className="py-1">{o.tradingsymbol}</td>
                  <td className="py-1">{o.side}</td>
                  <td className="py-1 text-right">{o.quantity}</td>
                  <td className="py-1 text-right text-ink-muted">{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
