import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const brokerAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    broker: {
      type: String,
      required: true,
      enum: ['mock', 'zerodha', 'angelone', 'upstox', 'dhan', 'fyers', 'iifl', 'motilal'],
    },
    label: { type: String, required: true },
    // Each field below stores AES-256-GCM ciphertext (base64). Plaintext NEVER persisted.
    credentials: {
      apiKey: { type: String },
      apiSecret: { type: String },
      clientCode: { type: String },
      password: { type: String },
      totpSecret: { type: String },
      accessToken: { type: String },
      refreshToken: { type: String },
      accessTokenExpiry: { type: Date },
    },
    isActive: { type: Boolean, default: true },
    isPrimary: { type: Boolean, default: false },
    capabilities: {
      canTradeEquity: { type: Boolean, default: true },
      canTradeFNO: { type: Boolean, default: true },
      canTradeMCX: { type: Boolean, default: false },
    },
    lastLoginAt: { type: Date },
    lastTokenRefreshAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

brokerAccountSchema.index({ userId: 1, broker: 1, label: 1 }, { unique: true });
brokerAccountSchema.index({ userId: 1, isPrimary: 1 });

type BrokerAccountSchemaType = InferSchemaType<typeof brokerAccountSchema>;
export type BrokerAccountLean = BrokerAccountSchemaType & { _id: mongoose.Types.ObjectId };
export type BrokerAccountDoc = HydratedDocument<BrokerAccountSchemaType>;

export const BrokerAccountModel: Model<BrokerAccountSchemaType> =
  (mongoose.models.BrokerAccount as Model<BrokerAccountSchemaType>) ||
  mongoose.model<BrokerAccountSchemaType>('BrokerAccount', brokerAccountSchema, 'brokerAccounts');
