import { z } from 'zod';
import { ExchangeSchema } from './instruments.js';

export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(['MARKET', 'LIMIT', 'SL', 'SL-M']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const ProductSchema = z.enum(['MIS', 'NRML', 'CNC']);
export type Product = z.infer<typeof ProductSchema>;

export const ValiditySchema = z.enum(['DAY', 'IOC']);
export type Validity = z.infer<typeof ValiditySchema>;

export const OrderStatusSchema = z.enum([
  'DRAFT',
  'QUEUED',
  'SENT',
  'PENDING',
  'OPEN',
  'COMPLETE',
  'REJECTED',
  'CANCELLED',
  'PARTIAL',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderModeSchema = z.enum(['live', 'paper']);
export type OrderMode = z.infer<typeof OrderModeSchema>;

export const NormalizedOrderRequestSchema = z.object({
  tradingsymbol: z.string(),
  exchange: ExchangeSchema,
  side: OrderSideSchema,
  quantity: z.number().int().positive(),
  orderType: OrderTypeSchema,
  product: ProductSchema,
  validity: ValiditySchema.default('DAY'),
  price: z.number().optional(),
  triggerPrice: z.number().optional(),
  disclosedQty: z.number().optional(),
  tag: z.string().optional(),
});
export type NormalizedOrderRequest = z.infer<typeof NormalizedOrderRequestSchema>;

export const NormalizedOrderSchema = NormalizedOrderRequestSchema.extend({
  brokerOrderId: z.string(),
  instrumentToken: z.string(),
  filledQty: z.number().default(0),
  pendingQty: z.number().default(0),
  averagePrice: z.number().default(0),
  status: OrderStatusSchema,
  statusMessage: z.string().optional(),
  placedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  filledAt: z.coerce.date().optional(),
});
export type NormalizedOrder = z.infer<typeof NormalizedOrderSchema>;

export const NormalizedTradeSchema = z.object({
  tradeId: z.string(),
  brokerOrderId: z.string(),
  tradingsymbol: z.string(),
  exchange: ExchangeSchema,
  side: OrderSideSchema,
  quantity: z.number(),
  price: z.number(),
  product: ProductSchema,
  timestamp: z.coerce.date(),
});
export type NormalizedTrade = z.infer<typeof NormalizedTradeSchema>;

export type OrderStatusEvent = {
  brokerOrderId: string;
  status: OrderStatus;
  filledQty: number;
  pendingQty: number;
  averagePrice: number;
  statusMessage?: string;
  timestamp: Date;
};
