import { z } from 'zod';
import { TimeframeSchema } from './instruments.js';

export const BacktestStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export type BacktestStatus = z.infer<typeof BacktestStatusSchema>;

export const BacktestRequestSchema = z.object({
  strategyId: z.string(),
  range: z.object({ from: z.coerce.date(), to: z.coerce.date() }),
  timeframe: TimeframeSchema,
  initialCapital: z.number().positive().default(100000),
  slippageBps: z.number().nonnegative().default(2),
  commissionPerOrder: z.number().nonnegative().default(20),
});
export type BacktestRequest = z.infer<typeof BacktestRequestSchema>;

export const TradeSummarySchema = z.object({
  entryTime: z.coerce.date(),
  exitTime: z.coerce.date().optional(),
  tradingsymbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number(),
  entryPrice: z.number(),
  exitPrice: z.number().optional(),
  pnl: z.number(),
  pnlPercent: z.number(),
  brokerage: z.number().default(0),
  reason: z.string().optional(),
});
export type TradeSummary = z.infer<typeof TradeSummarySchema>;

export const EquityPointSchema = z.object({
  t: z.coerce.date(),
  equity: z.number(),
  drawdown: z.number().default(0),
});
export type EquityPoint = z.infer<typeof EquityPointSchema>;

export const BacktestResultsSchema = z.object({
  totalPnL: z.number(),
  totalTrades: z.number(),
  winningTrades: z.number(),
  losingTrades: z.number(),
  winRate: z.number(),
  avgWin: z.number(),
  avgLoss: z.number(),
  profitFactor: z.number(),
  expectancy: z.number(),
  sharpe: z.number(),
  sortino: z.number(),
  calmar: z.number(),
  maxDrawdown: z.number(),
  maxDrawdownPercent: z.number(),
  longestLosingStreak: z.number().int(),
  equityCurve: z.array(EquityPointSchema),
  trades: z.array(TradeSummarySchema),
});
export type BacktestResults = z.infer<typeof BacktestResultsSchema>;
