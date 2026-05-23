import Link from 'next/link';

export default function Landing() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-semibold tracking-tight">Algo Trading Platform</h1>
        <p className="text-lg text-ink-muted">
          Multi-broker Indian algorithmic trading — backtest, paper trade, live execution. Built
          for NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCAP NIFTY and their options chains.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/login" className="btn btn-primary">
            Login
          </Link>
          <Link href="/register" className="btn btn-ghost border border-white/10">
            Create account
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-8 text-sm text-ink-muted">
          <div className="card p-4">
            <div className="text-2xl mb-1">⚡</div>
            <div className="text-ink">Low-latency ticks</div>
            <div>Broker WS → Redis → UI in &lt;200ms</div>
          </div>
          <div className="card p-4">
            <div className="text-2xl mb-1">🧪</div>
            <div className="text-ink">Paper = Live</div>
            <div>Same code path, just no broker dispatch.</div>
          </div>
          <div className="card p-4">
            <div className="text-2xl mb-1">📊</div>
            <div className="text-ink">Real metrics</div>
            <div>Sharpe, Sortino, Calmar, max DD, profit factor.</div>
          </div>
        </div>
      </div>
    </main>
  );
}
