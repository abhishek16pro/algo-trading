import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const backtestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    strategyId: { type: Schema.Types.ObjectId, ref: 'Strategy', required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      default: 'queued',
      index: true,
    },
    range: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    timeframe: {
      type: String,
      enum: ['1m', '3m', '5m', '15m', '30m', '1h', '1d'],
      required: true,
    },
    initialCapital: { type: Number, default: 100000 },
    slippageBps: { type: Number, default: 2 },
    commissionPerOrder: { type: Number, default: 20 },
    progress: { type: Number, default: 0 },

    results: { type: Schema.Types.Mixed },
    error: { type: String },

    completedAt: { type: Date },
  },
  { timestamps: true },
);

type BacktestSchemaType = InferSchemaType<typeof backtestSchema>;
export type BacktestLean = BacktestSchemaType & { _id: mongoose.Types.ObjectId };
export type BacktestDoc = HydratedDocument<BacktestSchemaType>;

export const BacktestModel: Model<BacktestSchemaType> =
  (mongoose.models.Backtest as Model<BacktestSchemaType>) ||
  mongoose.model<BacktestSchemaType>('Backtest', backtestSchema, 'backtests');
