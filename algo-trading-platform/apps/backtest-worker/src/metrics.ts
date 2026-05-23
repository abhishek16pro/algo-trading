import type { BacktestResults, EquityPoint, TradeSummary } from '@algo/shared-types';

const TRADING_DAYS = 252;

/** Compute every metric AlgoTest displays on a backtest result page. */
export function computeMetrics(
  initialCapital: number,
  equity: EquityPoint[],
  trades: TradeSummary[],
): BacktestResults {
  if (equity.length === 0) {
    return zeroResults();
  }
  const final = equity[equity.length - 1]!.equity;
  const totalPnL = final - initialCapital;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWin = wins.length === 0 ? 0 : wins.reduce((s, t) => s + t.pnl, 0) / wins.length;
  const avgLoss = losses.length === 0 ? 0 : losses.reduce((s, t) => s + t.pnl, 0) / losses.length;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss;
  const expectancy = (winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss;

  // Equity returns for Sharpe/Sortino
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!.equity;
    if (prev > 0) returns.push((equity[i]!.equity - prev) / prev);
  }
  const meanRet = returns.reduce((s, r) => s + r, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / Math.max(1, returns.length);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev === 0 ? 0 : (meanRet / stdDev) * Math.sqrt(TRADING_DAYS);

  const downside = returns.filter((r) => r < 0);
  const downsideVar = downside.reduce((s, r) => s + r * r, 0) / Math.max(1, downside.length);
  const downsideDev = Math.sqrt(downsideVar);
  const sortino = downsideDev === 0 ? 0 : (meanRet / downsideDev) * Math.sqrt(TRADING_DAYS);

  let maxDrawdownAbs = 0;
  let maxDrawdownPct = 0;
  let peak = equity[0]!.equity;
  for (const p of equity) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDrawdownAbs) maxDrawdownAbs = dd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }
  const calmar = maxDrawdownPct === 0 ? 0 : ((totalPnL / initialCapital) * 100) / maxDrawdownPct;

  let longestLosingStreak = 0;
  let cur = 0;
  for (const t of trades) {
    if (t.pnl <= 0) {
      cur += 1;
      if (cur > longestLosingStreak) longestLosingStreak = cur;
    } else {
      cur = 0;
    }
  }

  return {
    totalPnL,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
    expectancy,
    sharpe,
    sortino,
    calmar,
    maxDrawdown: maxDrawdownAbs,
    maxDrawdownPercent: maxDrawdownPct,
    longestLosingStreak,
    equityCurve: equity,
    trades,
  };
}

function zeroResults(): BacktestResults {
  return {
    totalPnL: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    expectancy: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    longestLosingStreak: 0,
    equityCurve: [],
    trades: [],
  };
}
