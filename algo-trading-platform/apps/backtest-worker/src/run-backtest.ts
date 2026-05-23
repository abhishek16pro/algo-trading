import { BacktestModel, HistoricalCandleModel, StrategyModel } from '@algo/db';
import { ema, rsi, crossesAbove, crossesBelow, supertrend } from '@algo/indicators';
import type { Candle, EquityPoint, TradeSummary } from '@algo/shared-types';
import type { Logger } from '@algo/utils';
import { computeMetrics } from './metrics.js';

/**
 * Single-instrument vectorized backtester. Walks the candle series once, maintains in-memory
 * state for one open position at a time (V1 simplification), and applies SL/TP intra-bar against
 * each bar's high/low.
 *
 * NOTE: Multi-leg options backtests need per-strike candle data and are deferred to V2.
 */
export async function runBacktest(
  backtestId: string,
  log: Logger,
  reportProgress: (p: number) => Promise<void> = async () => undefined,
): Promise<void> {
  const bt = await BacktestModel.findById(backtestId);
  if (!bt) throw new Error(`Backtest ${backtestId} not found`);
  bt.status = 'running';
  await bt.save();

  try {
    const strategy = await StrategyModel.findById(bt.strategyId).lean();
    if (!strategy) throw new Error('strategy not found');

    const tf = bt.timeframe;
    if (!bt.range?.from || !bt.range?.to) throw new Error('backtest range missing');
    const candles = await loadCandles(strategy.underlying as string, tf, bt.range.from, bt.range.to);
    if (candles.length === 0) throw new Error('no historical candles in range');

    const initial = bt.initialCapital ?? 100_000;
    const slippageBps = bt.slippageBps ?? 2;
    const commission = bt.commissionPerOrder ?? 20;

    let cash = initial;
    let position: { side: 'BUY' | 'SELL'; qty: number; entry: number; entryTime: Date } | null =
      null;
    const trades: TradeSummary[] = [];
    const equityCurve: EquityPoint[] = [];

    // Indicator series
    const closes = candles.map((c) => c.c);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const rsi14 = rsi(closes, 14);
    const st = supertrend(candles, 10, 3);

    let peakEquity = initial;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      // Manage open position: check SL/TP intra-bar using high/low
      if (position) {
        const exit = checkExit(position, c, strategy as unknown as Parameters<typeof checkExit>[2]);
        if (exit) {
          const exitPrice = applySlippage(exit.price, position.side === 'BUY' ? 'SELL' : 'BUY', slippageBps);
          const pnl = (exitPrice - position.entry) * position.qty * (position.side === 'BUY' ? 1 : -1) - commission * 2;
          cash += pnl;
          trades.push({
            entryTime: position.entryTime,
            exitTime: c.t,
            tradingsymbol: strategy.underlying as string,
            side: position.side,
            quantity: position.qty,
            entryPrice: position.entry,
            exitPrice,
            pnl,
            pnlPercent: (pnl / (position.entry * position.qty)) * 100,
            brokerage: commission * 2,
            reason: exit.reason,
          });
          position = null;
        }
      }

      // Entry: simple signal — EMA20 cross EMA50 + RSI confirmation if signal-based,
      // or supertrend flip for directional-options. Time-based handled separately.
      if (!position) {
        let enter: { side: 'BUY' | 'SELL'; reason: string } | null = null;
        if (strategy.type === 'signal-based') {
          if (crossesAbove(ema20, ema50, i) && (rsi14[i] ?? 50) > 50) {
            enter = { side: 'BUY', reason: 'ema20>ema50 + rsi>50' };
          } else if (crossesBelow(ema20, ema50, i) && (rsi14[i] ?? 50) < 50) {
            enter = { side: 'SELL', reason: 'ema20<ema50 + rsi<50' };
          }
        } else if (strategy.type === 'directional-options') {
          if (i > 0 && st.direction[i] === 1 && st.direction[i - 1] === -1) {
            enter = { side: 'BUY', reason: 'supertrend flip up' };
          } else if (i > 0 && st.direction[i] === -1 && st.direction[i - 1] === 1) {
            enter = { side: 'SELL', reason: 'supertrend flip down' };
          }
        }

        if (enter) {
          const qty = Math.max(1, Math.floor(cash * 0.95 / c.c));
          if (qty > 0) {
            const entryPrice = applySlippage(c.c, enter.side, slippageBps);
            position = { side: enter.side, qty, entry: entryPrice, entryTime: c.t };
            cash -= commission;
          }
        }
      }

      // Equity mark-to-market
      const mtm = position
        ? cash + position.qty * c.c * (position.side === 'BUY' ? 1 : -1) +
          position.qty * position.entry * (position.side === 'SELL' ? 2 : 0)
        : cash;
      peakEquity = Math.max(peakEquity, mtm);
      const dd = ((mtm - peakEquity) / peakEquity) * 100;
      equityCurve.push({ t: c.t, equity: mtm, drawdown: dd });

      if (i % 500 === 0) {
        const progress = i / candles.length;
        bt.progress = progress;
        await bt.save();
        await reportProgress(progress);
      }
    }

    bt.results = computeMetrics(initial, equityCurve, trades);
    bt.progress = 1;
    bt.status = 'done';
    bt.completedAt = new Date();
    await bt.save();
  } catch (err) {
    bt.status = 'failed';
    bt.error = err instanceof Error ? err.message : String(err);
    await bt.save();
    log.error({ err, backtestId }, 'backtest run failed');
    throw err;
  }
}

function applySlippage(price: number, side: 'BUY' | 'SELL', bps: number): number {
  const factor = 1 + (side === 'BUY' ? 1 : -1) * (bps / 10_000);
  return price * factor;
}

function checkExit(
  pos: { side: 'BUY' | 'SELL'; qty: number; entry: number },
  c: Candle,
  strategy: { exit?: { stopLoss?: { type: string; value: number }; target?: { type: string; value: number } } },
): { price: number; reason: string } | null {
  const sl = strategy.exit?.stopLoss;
  const tp = strategy.exit?.target;
  if (sl) {
    const slPrice = slDistance(pos.entry, sl.value, sl.type as 'percent' | 'points' | 'rupees', pos.side);
    if (pos.side === 'BUY' && c.l <= slPrice) return { price: slPrice, reason: 'SL' };
    if (pos.side === 'SELL' && c.h >= slPrice) return { price: slPrice, reason: 'SL' };
  }
  if (tp) {
    const tpPrice = tpDistance(pos.entry, tp.value, tp.type as 'percent' | 'points' | 'rupees', pos.side);
    if (pos.side === 'BUY' && c.h >= tpPrice) return { price: tpPrice, reason: 'TP' };
    if (pos.side === 'SELL' && c.l <= tpPrice) return { price: tpPrice, reason: 'TP' };
  }
  return null;
}

function slDistance(
  entry: number,
  value: number,
  type: 'percent' | 'points' | 'rupees',
  side: 'BUY' | 'SELL',
): number {
  const offset = type === 'percent' ? entry * (value / 100) : value;
  return side === 'BUY' ? entry - offset : entry + offset;
}

function tpDistance(
  entry: number,
  value: number,
  type: 'percent' | 'points' | 'rupees',
  side: 'BUY' | 'SELL',
): number {
  const offset = type === 'percent' ? entry * (value / 100) : value;
  return side === 'BUY' ? entry + offset : entry - offset;
}

async function loadCandles(
  underlying: string,
  tf: string,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  const ins = await import('@algo/db').then(async (m) => {
    return m.InstrumentModel.findOne({ underlying, instrumentType: 'IDX' }).lean();
  });
  if (!ins) return [];
  const rows = await HistoricalCandleModel.find({
    instrumentToken: ins.instrumentToken,
    timeframe: tf,
    t: { $gte: from, $lte: to },
  })
    .sort({ t: 1 })
    .lean();
  return rows.map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, oi: r.oi ?? undefined }));
}
