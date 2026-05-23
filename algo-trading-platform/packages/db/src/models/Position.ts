import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const legRefSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    qty: { type: Number, required: true },
    price: { type: Number, required: true },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    ts: { type: Date, default: Date.now },
  },
  { _id: false },
);

const positionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    strategyId: { type: Schema.Types.ObjectId, ref: 'Strategy', index: true },
    brokerAccountId: { type: Schema.Types.ObjectId, ref: 'BrokerAccount', required: true },
    mode: { type: String, enum: ['live', 'paper'], required: true, index: true },

    tradingsymbol: { type: String, required: true },
    exchange: {
      type: String,
      enum: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      required: true,
    },
    instrumentToken: { type: String, required: true, index: true },
    product: { type: String, enum: ['MIS', 'NRML', 'CNC'], required: true },

    netQty: { type: Number, default: 0 },
    buyQty: { type: Number, default: 0 },
    sellQty: { type: Number, default: 0 },
    avgPrice: { type: Number, default: 0 },
    lastPrice: { type: Number, default: 0 },
    ltp: { type: Number, default: 0 },

    pnl: { type: Number, default: 0 },
    mtm: { type: Number, default: 0 },
    realizedPnl: { type: Number, default: 0 },
    unrealizedPnl: { type: Number, default: 0 },

    legs: [legRefSchema],

    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

positionSchema.index(
  { userId: 1, brokerAccountId: 1, mode: 1, instrumentToken: 1, product: 1 },
  { unique: true },
);
positionSchema.index({ strategyId: 1, closedAt: 1 });

type PositionSchemaType = InferSchemaType<typeof positionSchema>;
export type PositionLean = PositionSchemaType & { _id: mongoose.Types.ObjectId };
export type PositionDoc = HydratedDocument<PositionSchemaType>;

export const PositionModel: Model<PositionSchemaType> =
  (mongoose.models.Position as Model<PositionSchemaType>) ||
  mongoose.model<PositionSchemaType>('Position', positionSchema, 'positions');
