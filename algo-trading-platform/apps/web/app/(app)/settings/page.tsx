'use client';

import { useAuth } from '@/store/auth';

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="card p-4">
        <h2 className="font-medium mb-2">Profile</h2>
        <div className="text-sm">{user?.name}</div>
        <div className="text-sm text-ink-muted">{user?.email}</div>
      </div>
      <div className="card p-4">
        <h2 className="font-medium mb-2">Two-factor authentication</h2>
        <div className="text-sm text-ink-muted">TOTP — not yet enabled.</div>
        <button className="btn btn-ghost border border-white/10 mt-2" disabled>
          Enable 2FA (coming soon)
        </button>
      </div>
    </div>
  );
}
