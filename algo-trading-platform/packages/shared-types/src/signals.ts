import { z } from 'zod';
import { TimeframeSchema } from './instruments.js';

export const IndicatorNameSchema = z.enum([
  'SMA',
  'EMA',
  'WMA',
  'RSI',
  'MACD',
  'BOLLINGER',
  'ATR',
  'SUPERTREND',
  'VWAP',
  'ADX',
  'STOCH',
  'PIVOT',
  'ORH',
  'ORL',
  'PRICE',
]);
export type IndicatorName = z.infer<typeof IndicatorNameSchema>;

export const SignalConditionSchema = z.enum([
  'crosses-above',
  'crosses-below',
  'greater-than',
  'less-than',
  'equal-to',
  'between',
]);
export type SignalCondition = z.infer<typeof SignalConditionSchema>;

export const IndicatorParamsSchema = z
  .object({
    period: z.number().int().positive().optional(),
    fastPeriod: z.number().int().positive().optional(),
    slowPeriod: z.number().int().positive().optional(),
    signalPeriod: z.number().int().positive().optional(),
    multiplier: z.number().positive().optional(),
    stdDev: z.number().positive().optional(),
    source: z.enum(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4']).optional(),
  })
  .passthrough();
export type IndicatorParams = z.infer<typeof IndicatorParamsSchema>;

export const SignalCompareToSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('value'), value: z.number() }),
  z.object({
    type: z.literal('indicator'),
    indicator: IndicatorNameSchema,
    params: IndicatorParamsSchema.optional(),
  }),
  z.object({ type: z.literal('price'), source: z.enum(['open', 'high', 'low', 'close']) }),
]);
export type SignalCompareTo = z.infer<typeof SignalCompareToSchema>;

export const SignalSchema = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  indicator: IndicatorNameSchema,
  params: IndicatorParamsSchema.default({}),
  condition: SignalConditionSchema,
  compareTo: SignalCompareToSchema,
  timeframe: TimeframeSchema,
  isPublic: z.boolean().default(false),
});
export type Signal = z.infer<typeof SignalSchema>;

export type SignalEvent = {
  signalId: string;
  instrumentToken: string;
  timeframe: string;
  ts: Date;
  value: number;
  comparedTo: number;
  candleTime: Date;
};
