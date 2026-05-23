'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type BrokerId = 'motilal' | 'zerodha' | 'angelone' | 'upstox' | 'dhan' | 'fyers' | 'mock';

type FieldKey =
  | 'apiKey'
  | 'apiSecret'
  | 'clientCode'
  | 'password'
  | 'totpSecret'
  | 'vendorInfo'
  | 'twoFA';

type FieldDef = {
  key: FieldKey;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  help?: string;
  required?: boolean;
};

/** Per-broker field specs — what to ask the user for. */
const BROKER_FIELDS: Record<BrokerId, FieldDef[]> = {
  motilal: [
    { key: 'apiKey', label: 'API Key', placeholder: 'from Motilal API portal', required: true },
    { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
    { key: 'clientCode', label: 'Client Code (UserID)', placeholder: 'e.g. AA017', required: true },
    { key: 'password', label: 'Trading Password', type: 'password', required: true },
    { key: 'twoFA', label: '2FA (PAN in CAPS or DOB DD/MM/YYYY)', placeholder: 'ABCDE1234F or 14/08/1990', required: true },
    { key: 'totpSecret', label: 'TOTP (6-digit from authenticator)', placeholder: '123456', help: 'Optional — leave blank to use 2FA only.' },
    { key: 'vendorInfo', label: 'Vendor Info (optional)', placeholder: 'e.g. T0240', help: 'Only set if Motilal assigned you one.' },
  ],
  zerodha: [
    { key: 'apiKey', label: 'API Key', required: true },
    { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
    { key: 'clientCode', label: 'Client ID', required: true },
  ],
  angelone: [
    { key: 'apiKey', label: 'API Key', required: true },
    { key: 'clientCode', label: 'Client Code', required: true },
    { key: 'password', label: 'PIN', type: 'password', required: true },
    { key: 'totpSecret', label: 'TOTP Secret', required: true, help: '32-char string from Angel One TOTP setup.' },
  ],
  upstox: [
    { key: 'apiKey', label: 'API Key', required: true },
    { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
  ],
  dhan: [
    { key: 'clientCode', label: 'Client ID', required: true },
    { key: 'apiSecret', label: 'Access Token', type: 'password', required: true },
  ],
  fyers: [
    { key: 'apiKey', label: 'App ID', required: true },
    { key: 'apiSecret', label: 'Secret ID', type: 'password', required: true },
  ],
  mock: [],
};

const BROKER_LABELS: Record<BrokerId, string> = {
  motilal: 'Motilal Oswal',
  zerodha: 'Zerodha Kite',
  angelone: 'Angel One',
  upstox: 'Upstox',
  dhan: 'Dhan',
  fyers: 'Fyers',
  mock: 'Mock (dev)',
};

export default function BrokersPage() {
  const qc = useQueryClient();
  const { data: accounts } = useQuery({
    queryKey: ['broker-accounts'],
    queryFn: async () => (await api.get('/brokers/accounts')).data,
  });

  const [broker, setBroker] = useState<BrokerId>('motilal');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [creds, setCreds] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [showFor, setShowFor] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const credentials: Record<string, string> = {};
      for (const f of BROKER_FIELDS[broker]) {
        const v = creds[f.key];
        if (v && v.trim()) credentials[f.key] = v.trim();
      }
      const body = {
        broker,
        label: label || `${BROKER_LABELS[broker]} account`,
        credentials,
        isPrimary,
      };
      return (await api.post('/brokers/accounts', body)).data;
    },
    onSuccess: () => {
      setCreds({} as Record<FieldKey, string>);
      setLabel('');
      qc.invalidateQueries({ queryKey: ['broker-accounts'] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/brokers/accounts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broker-accounts'] }),
  });

  const setPrimary = useMutation({
    mutationFn: async (id: string) => (await api.post(`/brokers/accounts/${id}/set-primary`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broker-accounts'] }),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold">Broker accounts</h1>

      {/* ---------- Connect ---------- */}
      <section className="card p-4 space-y-3">
        <h2 className="font-medium">Connect a broker</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Broker</span>
            <select
              value={broker}
              onChange={(e) => {
                setBroker(e.target.value as BrokerId);
                setCreds({} as Record<FieldKey, string>);
              }}
              className="input"
            >
              {(Object.keys(BROKER_LABELS) as BrokerId[]).map((b) => (
                <option key={b} value={b}>{BROKER_LABELS[b]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Label (your name for this account)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`My ${BROKER_LABELS[broker]}`} className="input" />
          </label>
        </div>

        {BROKER_FIELDS[broker].length === 0 ? (
          <p className="text-sm text-ink-muted">No credentials needed for {BROKER_LABELS[broker]}.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {BROKER_FIELDS[broker].map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">
                  {f.label}
                  {f.required && <span className="text-neg"> *</span>}
                </span>
                <input
                  type={f.type ?? 'text'}
                  value={creds[f.key] ?? ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  placeholder={f.placeholder ?? ''}
                  className="input"
                />
                {f.help && <span className="text-xs text-ink-muted opacity-70">{f.help}</span>}
              </label>
            ))}
          </div>
        )}

        <label className="flex items-start gap-2 mt-3">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            Set as my primary broker
            <span className="block text-xs text-ink-muted mt-0.5">
              Strategies you create without choosing a broker will route ORDERS here. This does
              NOT control market data — platform-wide market data comes from a single admin-
              configured broker (one connection for everyone, not per-user).
            </span>
          </span>
        </label>

        {create.isError && (
          <div className="text-neg text-sm">
            {(create.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Connect failed'}
          </div>
        )}
        {create.isSuccess && create.data && (
          <div className="card p-3 bg-pos/10 border border-pos/30 text-sm">
            ✓ Connected. Profile: <strong>{create.data.profile?.name ?? create.data.profile?.clientCode}</strong>
          </div>
        )}

        <div>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="btn btn-primary"
          >
            {create.isPending ? 'Verifying…' : 'Connect & verify'}
          </button>
        </div>
      </section>

      {/* ---------- Connected accounts ---------- */}
      <section className="space-y-3">
        <h2 className="font-medium">Connected accounts</h2>
        {!accounts || accounts.length === 0 ? (
          <div className="card p-6 text-center text-ink-muted text-sm">No broker accounts yet.</div>
        ) : (
          accounts.map((a: { id: string; broker: BrokerId; label: string; isActive: boolean; isPrimary: boolean; lastLoginAt?: string }) => (
            <div key={a.id} className="card p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">
                    {a.label}
                    {a.isPrimary && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-brand/30 text-brand">PRIMARY</span>}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {BROKER_LABELS[a.broker]} · {a.isActive ? 'active' : 'inactive'}
                  </div>
                  {a.lastLoginAt && (
                    <div className="text-xs text-ink-muted">Last login: {new Date(a.lastLoginAt).toLocaleString()}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  {!a.isPrimary && (
                    <button onClick={() => setPrimary.mutate(a.id)} className="btn btn-ghost border border-white/10 text-xs">
                      Make primary
                    </button>
                  )}
                  <button
                    onClick={() => setShowFor(showFor === a.id ? null : a.id)}
                    className="btn btn-ghost border border-white/10 text-xs"
                  >
                    {showFor === a.id ? 'Hide info' : 'Show profile + margin'}
                  </button>
                  <button onClick={() => del.mutate(a.id)} className="btn btn-ghost text-neg text-xs">
                    Disconnect
                  </button>
                </div>
              </div>
              {showFor === a.id && <AccountDetail id={a.id} />}
            </div>
          ))
        )}
      </section>

      <style jsx>{`
        :global(.input) {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          color: inherit;
          font-size: 0.875rem;
          width: 100%;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #3a86ff;
        }
      `}</style>
    </div>
  );
}

function AccountDetail({ id }: { id: string }) {
  const profile = useQuery({
    queryKey: ['broker-profile', id],
    queryFn: async () => (await api.get(`/brokers/accounts/${id}/profile`)).data,
  });
  const funds = useQuery({
    queryKey: ['broker-funds', id],
    queryFn: async () => (await api.get(`/brokers/accounts/${id}/funds`)).data,
  });

  return (
    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/5">
      <div>
        <h3 className="text-xs uppercase text-ink-muted mb-2">Profile</h3>
        {profile.isLoading && <div className="text-sm text-ink-muted">Loading…</div>}
        {profile.isError && (
          <div className="text-neg text-sm">
            {(profile.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed'}
          </div>
        )}
        {profile.data && (
          <dl className="text-sm space-y-1">
            <Detail k="Client" v={profile.data.clientCode} />
            <Detail k="Name" v={profile.data.name} />
            <Detail k="Email" v={profile.data.email} />
            <Detail k="Type" v={profile.data.userType} />
            <Detail k="Exchanges" v={profile.data.exchanges?.join(', ')} />
            <Detail k="Products" v={profile.data.products?.join(', ')} />
          </dl>
        )}
      </div>
      <div>
        <h3 className="text-xs uppercase text-ink-muted mb-2">Margin</h3>
        {funds.isLoading && <div className="text-sm text-ink-muted">Loading…</div>}
        {funds.isError && (
          <div className="text-neg text-sm">
            {(funds.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed'}
          </div>
        )}
        {funds.data && (
          <dl className="text-sm space-y-1">
            <Detail k="Available" v={'₹' + Number(funds.data.available).toLocaleString('en-IN')} />
            <Detail k="Used" v={'₹' + Number(funds.data.used).toLocaleString('en-IN')} />
            <Detail k="Total" v={'₹' + Number(funds.data.total).toLocaleString('en-IN')} />
          </dl>
        )}
      </div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v?: string | number }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <dt className="text-ink-muted">{k}</dt>
      <dd>{v ?? <span className="text-ink-muted">—</span>}</dd>
    </div>
  );
}
