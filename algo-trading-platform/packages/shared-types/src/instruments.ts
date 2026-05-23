import { z } from 'zod';

export const ExchangeSchema = z.enum(['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS']);
export type Exchange = z.infer<typeof ExchangeSchema>;

export const SegmentSchema = z.enum(['EQ', 'FUT', 'OPT', 'IDX', 'CUR', 'COM']);
export type Segment = z.infer<typeof SegmentSchema>;

export const InstrumentTypeSchema = z.enum(['EQ', 'FUT', 'CE', 'PE', 'IDX']);
export type InstrumentType = z.infer<typeof InstrumentTypeSchema>;

export const UnderlyingSchema = z.enum([
  'NIFTY',
  'BANKNIFTY',
  'SENSEX',
  'FINNIFTY',
  'MIDCPNIFTY',
  'BANKEX',
]);
export type Underlying = z.infer<typeof UnderlyingSchema>;

export const NormalizedInstrumentSchema = z.object({
  tradingsymbol: z.string(),
  exchange: ExchangeSchema,
  instrumentToken: z.string(),
  brokerTokens: z.record(z.string()).default({}),
  segment: SegmentSchema,
  instrumentType: InstrumentTypeSchema,
  name: z.string().optional(),
  expiry: z.coerce.date().optional(),
  strike: z.number().optional(),
  lotSize: z.number().int().positive().default(1),
  tickSize: z.number().positive().default(0.05),
  underlying: UnderlyingSchema.optional(),
});
export type NormalizedInstrument = z.infer<typeof NormalizedInstrumentSchema>;

export const TimeframeSchema = z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '1d']);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '1d': 375, // NSE session length
};

export const CandleSchema = z.object({
  t: z.coerce.date(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().default(0),
  oi: z.number().optional(),
});
export type Candle = z.infer<typeof CandleSchema>;
