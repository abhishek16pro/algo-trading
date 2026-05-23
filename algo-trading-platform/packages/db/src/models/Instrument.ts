import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const instrumentSchema = new Schema(
  {
    tradingsymbol: { type: String, required: true, index: true },
    exchange: {
      type: String,
      required: true,
      enum: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'],
      index: true,
    },
    instrumentToken: { type: String, required: true, unique: true, index: true },
    brokerTokens: { type: Map, of: String, default: {} },
    segment: {
      type: String,
      enum: ['EQ', 'FUT', 'OPT', 'IDX', 'CUR', 'COM'],
      required: true,
    },
    instrumentType: {
      type: String,
      enum: ['EQ', 'FUT', 'CE', 'PE', 'IDX'],
      required: true,
    },
    name: { type: String },
    expiry: { type: Date, index: true },
    strike: { type: Number },
    lotSize: { type: Number, default: 1 },
    tickSize: { type: Number, default: 0.05 },
    underlying: {
      type: String,
      enum: ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'BANKEX'],
      index: true,
    },
  },
  { timestamps: true },
);

instrumentSchema.index({ tradingsymbol: 1, exchange: 1 }, { unique: true });
instrumentSchema.index({ underlying: 1, expiry: 1, strike: 1 });
instrumentSchema.index({ underlying: 1, instrumentType: 1, expiry: 1 });

export type InstrumentDoc = InferSchemaType<typeof instrumentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const InstrumentModel: Model<InstrumentDoc> =
  (mongoose.models.Instrument as Model<InstrumentDoc>) ||
  mongoose.model<InstrumentDoc>('Instrument', instrumentSchema, 'instruments');
