'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/auth/login', { email, password });
      const me = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${r.data.accessToken}` },
      });
      setSession({ user: me.data, accessToken: r.data.accessToken, refreshToken: r.data.refreshToken });
      router.push('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="card p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
        />
        {error && <div className="text-neg text-sm">{error}</div>}
        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <a href="/register" className="block text-center text-sm text-ink-muted hover:text-ink">
          Need an account? Register
        </a>
      </form>
    </main>
  );
}
