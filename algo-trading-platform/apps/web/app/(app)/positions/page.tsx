'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function PositionsPage() {
  const qc = useQueryClient();
  const positions = useQuery({
    queryKey: ['positions', 'all'],
    queryFn: async () => (await api.get('/positions')).data,
    refetchInterval: 3000,
  });
  const square = useMutation({
    mutationFn: async (id: string) => (await api.post(`/positions/${id}/squareoff`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['positions'] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Positions</h1>
      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted bg-white/5">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2 text-right">Net Qty</th>
              <th className="px-3 py-2 text-right">Avg</th>
              <th className="px-3 py-2 text-right">LTP</th>
              <th className="px-3 py-2 text-right">P&L</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {positions.data?.map((p: { _id: string; tradingsymbol: string; mode: string; netQty: number; avgPrice: number; lastPrice: number; pnl: number }) => (
              <tr key={p._id} className="border-t border-white/5">
                <td className="px-3 py-2">{p.tradingsymbol}</td>
                <td className="px-3 py-2 text-ink-muted">{p.mode}</td>
                <td className="px-3 py-2 text-right">{p.netQty}</td>
                <td className="px-3 py-2 text-right">{p.avgPrice.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{p.lastPrice.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right ${p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                  ₹{p.pnl.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.netQty !== 0 && (
                    <button className="btn btn-ghost" onClick={() => square.mutate(p._id)}>
                      Square off
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
