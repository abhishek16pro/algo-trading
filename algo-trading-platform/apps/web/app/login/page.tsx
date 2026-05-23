'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { useAuth } from '@/store/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('demo@algotrade.local');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Wipe any stale tokens the moment the login page mounts. This prevents the api interceptor
  // from accidentally redirecting in a loop if old tokens are still around.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Use a bare axios call (no interceptors) so login behavior is predictable.
      const loginResp = await axios.post(
        `${API_BASE}/api/v1/auth/login`,
        { email, password },
        { headers: { 'Content-Type': 'application/json' } },
      );
      const { accessToken, refreshToken } = loginResp.data;
      if (!accessToken) {
        throw new Error('Login succeeded but no access token in response');
      }

      const meResp = await axios.get(`${API_BASE}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      setSession({ user: meResp.data, accessToken, refreshToken });
      router.push('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string; error?: string } }; message?: string };
      const status = e.response?.status;
      const apiMessage = e.response?.data?.message ?? e.response?.data?.error;
      let displayed: string;
      if (status === 401) displayed = 'Invalid email or password.';
      else if (status === 400) displayed = apiMessage ?? 'Bad request — check email format.';
      else if (status === 429) displayed = 'Too many attempts. Wait a minute and retry.';
      else if (status) displayed = `Server returned ${status}: ${apiMessage ?? 'unknown error'}`;
      else displayed = `Cannot reach API at ${API_BASE}. Is the gateway running? (${e.message ?? 'no message'})`;
      setError(displayed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="card p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-xs text-ink-muted">
          Demo: <code className="text-ink">demo@algotrade.local</code> /{' '}
          <code className="text-ink">demo1234</code>
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
          autoComplete="email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          className="w-full bg-bg border border-white/10 rounded-md px-3 py-2"
          required
          autoComplete="current-password"
        />
        {error && (
          <div className="text-neg text-sm bg-neg/10 border border-neg/30 rounded p-2">
            {error}
          </div>
        )}
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
