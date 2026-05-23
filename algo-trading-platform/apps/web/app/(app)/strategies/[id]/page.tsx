'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

type Preview = {
  ok: boolean;
  message?: string;
  context?: {
    underlying: string;
    spotPrice: number;
    atm: number;
    strikeStep: number;
    expiry: string;
  };
  resolved: Array<{
    legId: string;
    strikeSelection: string;
    strikeChosen: number | null;
    expiry: string;
    tradingsymbol: string | null;
    reason: string;
    order: Record<string, unknown> | null;
    slTrigger: number | null;
    tpTrigger: number | null;
  }>;
};

export default function StrategyDetail() {
  const params = useParams();
  const id = params.id as string;

  const { data, isLoading } = useQuery({
    queryKey: ['strategy', id],
    queryFn: async () => (await api.get(`/strategies/${id}`)).data,
  });

  const preview = useMutation<Preview>({
    mutationFn: async () => (await api.get(`/strategies/${id}/preview-legs`)).data,
  });

  const [showRaw, setShowRaw] = useState(false);

  if (isLoading) return <div className="text-ink-muted">Loading…</div>;
  if (!data) return <div className="text-neg">Not found</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <div className="text-sm text-ink-muted">{data.description}</div>
        </div>
        <button onClick={() => preview.mutate()} disabled={preview.isPending} className="btn btn-primary">
          {preview.isPending ? 'Resolving…' : '🔍 Preview legs (dry-run)'}
        </button>
      </div>

      {/* ---------------- Preview result ---------------- */}
      {preview.isSuccess && (
        <section className="card p-4 space-y-3">
          <h2 className="font-medium">Dry-run preview</h2>
          {!preview.data!.ok ? (
            <div className="text-neg text-sm bg-neg/10 border border-neg/30 rounded p-2">
              {preview.data!.message}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <Ctx label="Underlying" value={preview.data!.context!.underlying} />
                <Ctx label="Spot LTP" value={preview.data!.context!.spotPrice.toLocaleString('en-IN')} />
                <Ctx label="ATM" value={preview.data!.context!.atm} />
                <Ctx label="Strike step" value={preview.data!.context!.strikeStep} />
              </div>
              <div className="text-xs text-ink-muted">
                Expiry chosen:{' '}
                <code className="text-ink">
                  {new Date(preview.data!.context!.expiry).toLocaleDateString()}
                </code>
              </div>

              <div className="space-y-2 pt-2">
                {preview.data!.resolved.map((r) => (
                  <div key={r.legId} className="card p-3 space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span className="font-medium">{r.legId}</span>
                      <span className="text-xs text-ink-muted">{r.strikeSelection}</span>
                    </div>
                    <div className="text-xs text-ink-muted">{r.reason}</div>
                    {r.order ? (
                      <>
                        <div className="text-sm">
                          <span className="font-mono">{r.tradingsymbol}</span> · strike{' '}
                          <span className="text-ink">{r.strikeChosen}</span> · qty{' '}
                          <span className="text-ink">{String(r.order.quantity)}</span> ·{' '}
                          <span className={r.order.side === 'BUY' ? 'pnl-pos' : 'pnl-neg'}>
                            {String(r.order.side)}
                          </span>
                        </div>
                        {(r.slTrigger || r.tpTrigger) && (
                          <div className="text-xs text-ink-muted">
                            {r.slTrigger !== null && (
                              <>
                                SL trigger ≈ <span className="text-neg">{r.slTrigger.toFixed(2)}</span>
                              </>
                            )}
                            {r.slTrigger !== null && r.tpTrigger !== null && ' · '}
                            {r.tpTrigger !== null && (
                              <>
                                TP price ≈ <span className="text-pos">{r.tpTrigger.toFixed(2)}</span>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-neg">Could not resolve to an instrument.</div>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowRaw((v) => !v)}
                className="btn btn-ghost text-xs text-ink-muted"
              >
                {showRaw ? 'Hide' : 'Show'} raw order bodies (JSON)
              </button>
              {showRaw && (
                <pre className="text-xs overflow-x-auto bg-bg p-3 rounded border border-white/5">
                  {JSON.stringify(preview.data!.resolved.map((r) => r.order), null, 2)}
                </pre>
              )}
            </>
          )}
        </section>
      )}

      {preview.isError && (
        <div className="card p-3 text-neg text-sm">
          {(preview.error as { response?: { data?: { message?: string } } })?.response?.data
            ?.message ?? 'Preview failed'}
        </div>
      )}

      {/* ---------------- Strategy config JSON ---------------- */}
      <section className="card p-4">
        <h2 className="font-medium mb-2">Configuration</h2>
        <pre className="text-xs overflow-x-auto bg-bg p-3 rounded">
          {JSON.stringify(data, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Ctx({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-ink-muted uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
