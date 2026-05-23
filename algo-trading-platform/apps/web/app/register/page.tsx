'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/auth/register', form);
      setSession({ user: r.data.user, accessToken: r.data.accessToken, refreshToken: r.data.refreshToken });
      router.push('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="card p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Create account</h1>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Full name"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
        />
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="you@example.com"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
        />
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="password (8+ chars)"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
          minLength={8}
        />
        {error && <div className="text-neg text-sm">{error}</div>}
        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
        <a href="/login" className="block text-center text-sm text-ink-muted hover:text-ink">
          Already have an account? Sign in
        </a>
      </form>
    </main>
  );
}
