import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Mongo Time-series collection — automatically optimized storage for high-volume OHLC data.
 * The collection must be created with the time-series options at first connection. See
 * `ensureTimeSeries()` below.
 */
const historicalCandleSchema = new Schema(
  {
    instrumentToken: { type: String, required: true },
    timeframe: {
      type: String,
      enum: ['1m', '3m', '5m', '15m', '30m', '1h', '1d'],
      required: true,
    },
    t: { type: Date, required: true },
    o: { type: Number, required: true },
    h: { type: Number, required: true },
    l: { type: Number, required: true },
    c: { type: Number, required: true },
    v: { type: Number, default: 0 },
    oi: { type: Number },
  },
  { timestamps: false, autoCreate: false },
);

historicalCandleSchema.index({ instrumentToken: 1, timeframe: 1, t: 1 });

export type HistoricalCandleDoc = InferSchemaType<typeof historicalCandleSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const HistoricalCandleModel: Model<HistoricalCandleDoc> =
  (mongoose.models.HistoricalCandle as Model<HistoricalCandleDoc>) ||
  mongoose.model<HistoricalCandleDoc>(
    'HistoricalCandle',
    historicalCandleSchema,
    'historicalCandles',
  );

/** Create the historicalCandles collection as a Mongo time-series, idempotent. */
export async function ensureTimeSeries(): Promise<void> {
  const conn = mongoose.connection;
  if (conn.readyState !== 1) return;
  const db = conn.db;
  if (!db) return;
  const existing = await db.listCollections({ name: 'historicalCandles' }).toArray();
  if (existing.length > 0) return;
  await db.createCollection('historicalCandles', {
    timeseries: {
      timeField: 't',
      metaField: 'meta',
      granularity: 'minutes',
    },
    expireAfterSeconds: 60 * 60 * 24 * 365 * 5,
  });
}
