import { z } from 'zod';
import { ExchangeSchema } from './instruments.js';
import { ProductSchema } from './orders.js';

export const NormalizedPositionSchema = z.object({
  tradingsymbol: z.string(),
  exchange: ExchangeSchema,
  instrumentToken: z.string(),
  product: ProductSchema,
  netQty: z.number(),
  buyQty: z.number().default(0),
  sellQty: z.number().default(0),
  avgPrice: z.number(),
  lastPrice: z.number(),
  pnl: z.number(),
  realizedPnl: z.number().default(0),
  unrealizedPnl: z.number().default(0),
  mtm: z.number().default(0),
  multiplier: z.number().default(1),
});
export type NormalizedPosition = z.infer<typeof NormalizedPositionSchema>;

export const NormalizedHoldingSchema = z.object({
  tradingsymbol: z.string(),
  exchange: ExchangeSchema,
  instrumentToken: z.string(),
  quantity: z.number(),
  avgPrice: z.number(),
  lastPrice: z.number(),
  pnl: z.number(),
  dayChange: z.number().optional(),
  dayChangePercent: z.number().optional(),
});
export type NormalizedHolding = z.infer<typeof NormalizedHoldingSchema>;

export const FundsSchema = z.object({
  available: z.number(),
  used: z.number(),
  total: z.number(),
});
export type Funds = z.infer<typeof FundsSchema>;
