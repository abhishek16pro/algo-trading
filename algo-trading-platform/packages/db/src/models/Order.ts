import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const statusHistorySchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    message: { type: String },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    strategyId: { type: Schema.Types.ObjectId, ref: 'Strategy', index: true },
    brokerAccountId: { type: Schema.Types.ObjectId, ref: 'BrokerAccount', required: true },
    mode: { type: String, enum: ['live', 'paper'], required: true, index: true },
    brokerOrderId: { type: String, index: true, sparse: true },
    idempotencyKey: { type: String, index: true, sparse: true, unique: true },

    tradingsymbol: { type: String, required: true },
    exchange: {
      type: String,
      enum: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      required: true,
    },
    instrumentToken: { type: String, required: true, index: true },

    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    orderType: { type: String, enum: ['MARKET', 'LIMIT', 'SL', 'SL-M'], required: true },
    product: { type: String, enum: ['MIS', 'NRML', 'CNC'], required: true },
    validity: { type: String, enum: ['DAY', 'IOC'], default: 'DAY' },

    quantity: { type: Number, required: true },
    filledQty: { type: Number, default: 0 },
    pendingQty: { type: Number, default: 0 },

    price: { type: Number, default: 0 },
    triggerPrice: { type: Number },
    averagePrice: { type: Number, default: 0 },

    status: {
      type: String,
      enum: [
        'DRAFT',
        'QUEUED',
        'SENT',
        'PENDING',
        'OPEN',
        'COMPLETE',
        'REJECTED',
        'CANCELLED',
        'PARTIAL',
      ],
      default: 'DRAFT',
      index: true,
    },
    statusMessage: { type: String },
    statusHistory: [statusHistorySchema],

    tag: { type: String, index: true },
    parentOrderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    childOrderIds: [{ type: Schema.Types.ObjectId, ref: 'Order' }],

    placedAt: { type: Date, default: Date.now },
    filledAt: { type: Date },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, status: 1, placedAt: -1 });
orderSchema.index({ strategyId: 1, placedAt: -1 });

type OrderSchemaType = InferSchemaType<typeof orderSchema>;
export type OrderLean = OrderSchemaType & { _id: mongoose.Types.ObjectId };
export type OrderDoc = HydratedDocument<OrderSchemaType>;

export const OrderModel: Model<OrderSchemaType> =
  (mongoose.models.Order as Model<OrderSchemaType>) ||
  mongoose.model<OrderSchemaType>('Order', orderSchema, 'orders');
