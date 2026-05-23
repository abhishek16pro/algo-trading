import { z } from 'zod';
import { UnderlyingSchema } from './instruments.js';

export const StrategyTypeSchema = z.enum([
  'signal-based',
  'time-based',
  'options-strangle',
  'options-straddle',
  'iron-condor',
  'directional-options',
  'custom',
]);
export type StrategyType = z.infer<typeof StrategyTypeSchema>;

export const StrategyModeSchema = z.enum(['live', 'paper', 'stopped']);
export type StrategyMode = z.infer<typeof StrategyModeSchema>;

export const StrategyStateSchema = z.enum(['idle', 'running', 'paused', 'error']);
export type StrategyState = z.infer<typeof StrategyStateSchema>;

export const StrategySegmentSchema = z.enum(['index', 'futures', 'options']);
export type StrategySegment = z.infer<typeof StrategySegmentSchema>;

export const StrikeSelectionSchema = z.enum([
  'ATM',
  'ITM',
  'OTM',
  'closest-premium',
  'delta-based',
]);
export type StrikeSelection = z.infer<typeof StrikeSelectionSchema>;

export const ExpirySelectionSchema = z.enum(['current-week', 'next-week', 'monthly']);
export type ExpirySelection = z.infer<typeof ExpirySelectionSchema>;

export const LegConfigSchema = z.object({
  legId: z.string(),
  action: z.enum(['BUY', 'SELL']),
  optionType: z.enum(['CE', 'PE']),
  strikeSelection: StrikeSelectionSchema,
  strikeOffset: z.number().int().default(0),
  targetPremium: z.number().optional(),
  targetDelta: z.number().optional(),
  lots: z.number().int().positive().default(1),
  expiry: ExpirySelectionSchema.default('current-week'),
  individualSL: z
    .object({
      type: z.enum(['percent', 'points', 'rupees']),
      value: z.number(),
    })
    .optional(),
  individualTP: z
    .object({
      type: z.enum(['percent', 'points', 'rupees']),
      value: z.number(),
    })
    .optional(),
  waitAndTrade: z
    .object({
      enabled: z.boolean().default(false),
      type: z.enum(['percent']).default('percent'),
      value: z.number().default(0),
    })
    .optional(),
});
export type LegConfig = z.infer<typeof LegConfigSchema>;

export const SignalRefSchema = z.object({
  signalId: z.string(),
  logic: z.enum(['AND', 'OR']).default('AND'),
});
export type SignalRef = z.infer<typeof SignalRefSchema>;

const SLValueSchema = z.object({
  type: z.enum(['percent', 'points', 'rupees']),
  value: z.number().positive(),
});

export const StrategyEntrySchema = z.object({
  triggerType: z.enum(['time', 'signal', 'price', 'indicator']),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  signals: z.array(SignalRefSchema).optional(),
  legs: z.array(LegConfigSchema).optional(),
});
export type StrategyEntry = z.infer<typeof StrategyEntrySchema>;

export const StrategyExitSchema = z.object({
  stopLoss: SLValueSchema.optional(),
  target: SLValueSchema.optional(),
  trailingSL: z
    .object({
      type: z.enum(['percent', 'points', 'rupees']),
      value: z.number().positive(),
      step: z.number().positive(),
    })
    .optional(),
  timeExit: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reEntry: z
    .object({
      enabled: z.boolean().default(false),
      maxAttempts: z.number().int().min(0).max(10).default(0),
    })
    .optional(),
});
export type StrategyExit = z.infer<typeof StrategyExitSchema>;

export const StrategyRiskSchema = z.object({
  capitalDeployed: z.number().positive(),
  maxLossPerDay: z.number().positive(),
  maxLossPerTrade: z.number().positive(),
  maxPositions: z.number().int().positive().default(5),
  lotMultiplier: z.number().int().positive().default(1),
});
export type StrategyRisk = z.infer<typeof StrategyRiskSchema>;

export const StrategyScheduleSchema = z.object({
  activeDays: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:15'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).default('15:30'),
  timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
});
export type StrategySchedule = z.infer<typeof StrategyScheduleSchema>;

export const StrategySchema = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: StrategyTypeSchema,
  mode: StrategyModeSchema.default('stopped'),
  brokerAccountId: z.string().optional(),
  underlying: UnderlyingSchema,
  segment: StrategySegmentSchema,
  entry: StrategyEntrySchema,
  exit: StrategyExitSchema,
  risk: StrategyRiskSchema,
  schedule: StrategyScheduleSchema,
  state: StrategyStateSchema.default('idle'),
  lastRunAt: z.coerce.date().optional(),
  lastError: z.string().optional(),
  metrics: z
    .object({
      totalTrades: z.number().default(0),
      winRate: z.number().default(0),
      totalPnL: z.number().default(0),
      maxDrawdown: z.number().default(0),
    })
    .default({}),
});
export type Strategy = z.infer<typeof StrategySchema>;
