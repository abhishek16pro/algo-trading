'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/store/auth';
import clsx from 'clsx';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/strategies', label: 'Strategies' },
  { href: '/backtest', label: 'Backtest' },
  { href: '/live', label: 'Live' },
  { href: '/paper', label: 'Paper' },
  { href: '/positions', label: 'Positions' },
  { href: '/orders', label: 'Orders' },
  { href: '/signals', label: 'Signals' },
  { href: '/brokers', label: 'Brokers' },
  { href: '/instruments', label: 'Instruments' },
  { href: '/settings', label: 'Settings' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem('accessToken')) router.push('/login');
  }, [router]);

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-white/5 p-4 space-y-1">
        <div className="text-lg font-semibold px-2 pb-4">AlgoTrade</div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'block px-3 py-1.5 rounded-md text-sm',
              path?.startsWith(item.href)
                ? 'bg-brand/20 text-ink'
                : 'text-ink-muted hover:text-ink hover:bg-white/5',
            )}
          >
            {item.label}
          </Link>
        ))}
        <div className="border-t border-white/5 mt-6 pt-4 px-2 text-xs text-ink-muted">
          {user?.email}
          <button
            onClick={() => {
              logout();
              router.push('/login');
            }}
            className="block mt-2 text-ink-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
