import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const legSchema = new Schema(
  {
    legId: { type: String, required: true },
    action: { type: String, enum: ['BUY', 'SELL'], required: true },
    optionType: { type: String, enum: ['CE', 'PE'], required: true },
    strikeSelection: {
      type: String,
      enum: ['ATM', 'ITM', 'OTM', 'closest-premium', 'delta-based'],
      required: true,
    },
    strikeOffset: { type: Number, default: 0 },
    targetPremium: { type: Number },
    targetDelta: { type: Number },
    lots: { type: Number, default: 1 },
    expiry: {
      type: String,
      enum: ['current-week', 'next-week', 'monthly'],
      default: 'current-week',
    },
    individualSL: {
      type: { type: String, enum: ['percent', 'points', 'rupees'] },
      value: { type: Number },
    },
    individualTP: {
      type: { type: String, enum: ['percent', 'points', 'rupees'] },
      value: { type: Number },
    },
    waitAndTrade: {
      enabled: { type: Boolean, default: false },
      type: { type: String, enum: ['percent'], default: 'percent' },
      value: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const strategySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    type: {
      type: String,
      enum: [
        'signal-based',
        'time-based',
        'options-strangle',
        'options-straddle',
        'iron-condor',
        'directional-options',
        'custom',
      ],
      required: true,
    },
    mode: { type: String, enum: ['live', 'paper', 'stopped'], default: 'stopped' },
    brokerAccountId: { type: Schema.Types.ObjectId, ref: 'BrokerAccount' },
    underlying: {
      type: String,
      enum: ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'BANKEX'],
      required: true,
    },
    segment: { type: String, enum: ['index', 'futures', 'options'], required: true },

    entry: {
      triggerType: {
        type: String,
        enum: ['time', 'signal', 'price', 'indicator'],
        required: true,
      },
      time: { type: String },
      signals: [{ signalId: { type: String }, logic: { type: String, enum: ['AND', 'OR'] } }],
      legs: [legSchema],
    },

    exit: {
      stopLoss: {
        type: { type: String, enum: ['percent', 'points', 'rupees'] },
        value: { type: Number },
      },
      target: {
        type: { type: String, enum: ['percent', 'points', 'rupees'] },
        value: { type: Number },
      },
      trailingSL: {
        type: { type: String, enum: ['percent', 'points', 'rupees'] },
        value: { type: Number },
        step: { type: Number },
      },
      timeExit: { type: String },
      reEntry: {
        enabled: { type: Boolean, default: false },
        maxAttempts: { type: Number, default: 0 },
      },
    },

    risk: {
      capitalDeployed: { type: Number, required: true },
      maxLossPerDay: { type: Number, required: true },
      maxLossPerTrade: { type: Number, required: true },
      maxPositions: { type: Number, default: 5 },
      lotMultiplier: { type: Number, default: 1 },
    },

    schedule: {
      activeDays: [{ type: String, enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] }],
      startTime: { type: String, default: '09:15' },
      endTime: { type: String, default: '15:30' },
      timezone: { type: String, default: 'Asia/Kolkata' },
    },

    state: {
      type: String,
      enum: ['idle', 'running', 'paused', 'error'],
      default: 'idle',
      index: true,
    },
    lastRunAt: { type: Date },
    lastError: { type: String },
    metrics: {
      totalTrades: { type: Number, default: 0 },
      winRate: { type: Number, default: 0 },
      totalPnL: { type: Number, default: 0 },
      maxDrawdown: { type: Number, default: 0 },
    },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

strategySchema.index({ userId: 1, mode: 1, state: 1 });

type StrategySchemaType = InferSchemaType<typeof strategySchema>;
export type StrategyLean = StrategySchemaType & { _id: mongoose.Types.ObjectId };
export type StrategyDoc = HydratedDocument<StrategySchemaType>;

export const StrategyModel: Model<StrategySchemaType> =
  (mongoose.models.Strategy as Model<StrategySchemaType>) ||
  mongoose.model<StrategySchemaType>('Strategy', strategySchema, 'strategies');
