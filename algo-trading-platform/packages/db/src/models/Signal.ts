import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const signalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    indicator: {
      type: String,
      enum: [
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
      ],
      required: true,
    },
    params: { type: Schema.Types.Mixed, default: {} },
    condition: {
      type: String,
      enum: ['crosses-above', 'crosses-below', 'greater-than', 'less-than', 'equal-to', 'between'],
      required: true,
    },
    compareTo: { type: Schema.Types.Mixed, required: true },
    timeframe: {
      type: String,
      enum: ['1m', '3m', '5m', '15m', '30m', '1h', '1d'],
      required: true,
    },
    isPublic: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

type SignalSchemaType = InferSchemaType<typeof signalSchema>;
export type SignalLean = SignalSchemaType & { _id: mongoose.Types.ObjectId };
export type SignalDoc = HydratedDocument<SignalSchemaType>;

export const SignalModel: Model<SignalSchemaType> =
  (mongoose.models.Signal as Model<SignalSchemaType>) ||
  mongoose.model<SignalSchemaType>('Signal', signalSchema, 'signals');
