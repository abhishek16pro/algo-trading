'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type ServiceStatus = {
  name: string;
  status: 'up' | 'down' | 'never-seen';
  lastSeenMs: number | null;
  ageMs: number | null;
  pid: number | null;
  uptimeSec: number | null;
};

type Health = {
  services: ServiceStatus[];
  datastores: { mongo: { status: string }; redis: { status: string } };
  ts: number;
};

type Tick = {
  token: string;
  ltp: number | null;
  vol: number | null;
  oi: number | null;
  ts: number | null;
  ageMs: number | null;
  fresh: boolean;
  refcount: number;
};

type MarketData = {
  source: {
    type: string;
    accountId: string | null;
    broker: string | null;
    label: string | null;
    lastLoginAt: string | null;
  };
  summary: { totalSubscriptions: number; freshTicks: number; staleTicks: number };
  ticks: Tick[];
};

type BrokerAccount = {
  id: string;
  broker: string;
  label: string;
  isActive: boolean;
  isPrimary: boolean;
  isPlatformPrimary: boolean;
  user: { email: string; name: string } | null;
  lastLoginAt: string | null;
};

type Stats = {
  users: number;
  brokers: number;
  instruments: number;
  strategies: number;
  runningStrategies: number;
  openOrders: number;
  openPositions: number;
};

export default function AdminPage() {
  const qc = useQueryClient();

  const health = useQuery<Health>({
    queryKey: ['admin', 'health'],
    queryFn: async () => (await api.get('/admin/health')).data,
    refetchInterval: 3000,
  });

  const md = useQuery<MarketData>({
    queryKey: ['admin', 'market-data'],
    queryFn: async () => (await api.get('/admin/market-data')).data,
    refetchInterval: 2000,
  });

  const accounts = useQuery<BrokerAccount[]>({
    queryKey: ['admin', 'broker-accounts'],
    queryFn: async () => (await api.get('/admin/broker-accounts')).data,
  });

  const stats = useQuery<Stats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => (await api.get('/admin/stats')).data,
    refetchInterval: 10000,
  });

  const setPrimary = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/admin/market-data/primary/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Admin · System</h1>
        <span className="text-xs text-ink-muted">
          {health.data && `last refresh ${new Date(health.data.ts).toLocaleTimeString()}`}
        </span>
      </div>

      {/* ============ Service health ============ */}
      <section className="card p-4 space-y-3">
        <h2 className="font-medium">Service health</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {health.data?.services.map((s) => (
            <div
              key={s.name}
              className={`card p-3 ${
                s.status === 'up'
                  ? 'border-pos/30 bg-pos/5'
                  : s.status === 'down'
                    ? 'border-neg/30 bg-neg/5'
                    : 'border-white/10'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">{s.name}</span>
                <span className={`text-xs ${s.status === 'up' ? 'pnl-pos' : s.status === 'down' ? 'pnl-neg' : 'text-ink-muted'}`}>
                  {dot(s.status)} {s.status}
                </span>
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {s.ageMs !== null ? `seen ${(s.ageMs / 1000).toFixed(1)}s ago` : 'never seen'}
              </div>
              {s.uptimeSec !== null && (
                <div className="text-xs text-ink-muted">uptime {formatUptime(s.uptimeSec)}</div>
              )}
              {s.pid && <div className="text-xs text-ink-muted">pid {s.pid}</div>}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
          <Datastore name="MongoDB" status={health.data?.datastores.mongo.status ?? 'unknown'} />
          <Datastore name="Redis" status={health.data?.datastores.redis.status ?? 'unknown'} />
        </div>
      </section>

      {/* ============ Platform stats ============ */}
      <section className="card p-4 space-y-3">
        <h2 className="font-medium">Platform stats</h2>
        <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
          <Stat label="Users" value={stats.data?.users} />
          <Stat label="Brokers" value={stats.data?.brokers} />
          <Stat label="Instruments" value={stats.data?.instruments} />
          <Stat label="Strategies" value={stats.data?.strategies} />
          <Stat label="Running" value={stats.data?.runningStrategies} />
          <Stat label="Open orders" value={stats.data?.openOrders} />
          <Stat label="Open positions" value={stats.data?.openPositions} />
        </div>
      </section>

      {/* ============ Market data ============ */}
      <section className="card p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-medium">Market-data source</h2>
          {md.data?.summary && (
            <span className="text-xs text-ink-muted">
              <span className="pnl-pos">{md.data.summary.freshTicks}</span> fresh /{' '}
              <span className="pnl-neg">{md.data.summary.staleTicks}</span> stale /{' '}
              {md.data.summary.totalSubscriptions} total
            </span>
          )}
        </div>
        {md.data?.source.broker ? (
          <div className="text-sm text-ink-muted">
            <span className="text-ink">{md.data.source.broker}</span> · {md.data.source.label} ·{' '}
            <code className="text-xs">{md.data.source.type}</code>
          </div>
        ) : (
          <div className="text-sm text-neg">⚠ No market-data broker configured</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted bg-white/5">
              <tr>
                <th className="px-3 py-2">Token</th>
                <th className="px-3 py-2 text-right">LTP</th>
                <th className="px-3 py-2 text-right">Vol</th>
                <th className="px-3 py-2 text-right">OI</th>
                <th className="px-3 py-2 text-right">Refs</th>
                <th className="px-3 py-2">Last tick</th>
              </tr>
            </thead>
            <tbody>
              {md.data?.ticks.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                    No active subscriptions. Deploy a strategy to see ticks flow.
                  </td>
                </tr>
              )}
              {md.data?.ticks.map((t) => (
                <tr key={t.token} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs">{t.token}</td>
                  <td className="px-3 py-2 text-right">{t.ltp?.toLocaleString('en-IN') ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{t.vol ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{t.oi ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-ink-muted">{t.refcount}</td>
                  <td className={`px-3 py-2 text-xs ${t.fresh ? 'pnl-pos' : 'pnl-neg'}`}>
                    {t.ageMs !== null
                      ? t.ageMs < 1000
                        ? `${t.ageMs}ms ago`
                        : `${(t.ageMs / 1000).toFixed(1)}s ago`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ Pick platform primary broker ============ */}
      <section className="card p-4 space-y-3">
        <h2 className="font-medium">Pick platform market-data broker</h2>
        <p className="text-xs text-ink-muted">
          ONE account streams market data for the entire platform. Set it from any user&apos;s
          connected broker accounts below. Restart <code>market-data-service</code> after switching.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted bg-white/5">
              <tr>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Broker</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.data?.map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="px-3 py-2">
                    {a.label}
                    {a.isPlatformPrimary && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded bg-brand/30 text-brand">
                        PLATFORM PRIMARY
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{a.broker}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">{a.user?.email ?? '—'}</td>
                  <td className="px-3 py-2">{a.isActive ? '🟢' : '⚪'}</td>
                  <td className="px-3 py-2 text-right">
                    {!a.isPlatformPrimary && a.isActive && (
                      <button
                        onClick={() => setPrimary.mutate(a.id)}
                        disabled={setPrimary.isPending}
                        className="btn btn-ghost border border-white/10 text-xs"
                      >
                        Use for market data
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {setPrimary.isSuccess && (
          <div className="text-sm bg-pos/10 border border-pos/30 rounded p-2">
            ✓ {setPrimary.data?.message}
          </div>
        )}
        {setPrimary.isError && (
          <div className="text-sm text-neg bg-neg/10 border border-neg/30 rounded p-2">
            {(setPrimary.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed'}
          </div>
        )}
      </section>
    </div>
  );
}

function dot(status: string): string {
  if (status === 'up') return '●';
  if (status === 'down') return '●';
  return '○';
}

function Datastore({ name, status }: { name: string; status: string }) {
  return (
    <div className={`card p-3 ${status === 'up' ? 'border-pos/30 bg-pos/5' : 'border-neg/30 bg-neg/5'}`}>
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">{name}</span>
        <span className={`text-xs ${status === 'up' ? 'pnl-pos' : 'pnl-neg'}`}>● {status}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-muted uppercase tracking-wide">{label}</div>
      <div className="text-xl font-semibold">{value ?? '—'}</div>
    </div>
  );
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}
