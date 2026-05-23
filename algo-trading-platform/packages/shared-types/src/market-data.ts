import { z } from 'zod';
import { BrokerIdSchema } from './brokers.js';

export const LevelSchema = z.object({
  price: z.number(),
  qty: z.number(),
  orders: z.number().optional(),
});
export type Level = z.infer<typeof LevelSchema>;

export const DepthSchema = z.object({
  bids: z.array(LevelSchema),
  asks: z.array(LevelSchema),
});
export type Depth = z.infer<typeof DepthSchema>;

export const TickSchema = z.object({
  instrumentToken: z.string(),
  brokerToken: z.string(),
  ltp: z.number(),
  ltt: z.coerce.date(),
  volume: z.number().default(0),
  oi: z.number().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  bidQty: z.number().optional(),
  askQty: z.number().optional(),
  change: z.number().optional(),
  changePercent: z.number().optional(),
  ohlc: z
    .object({
      o: z.number(),
      h: z.number(),
      l: z.number(),
      c: z.number(),
    })
    .optional(),
  depth: DepthSchema.optional(),
  receivedAt: z.coerce.date(),
  broker: BrokerIdSchema,
});
export type Tick = z.infer<typeof TickSchema>;

export const QuoteSchema = z.object({
  instrumentToken: z.string(),
  ltp: z.number(),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number().optional(),
  volume: z.number().optional(),
  oi: z.number().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  timestamp: z.coerce.date(),
});
export type NormalizedQuote = z.infer<typeof QuoteSchema>;

export const SubscriptionModeSchema = z.enum(['ltp', 'quote', 'full']);
export type SubscriptionMode = z.infer<typeof SubscriptionModeSchema>;
