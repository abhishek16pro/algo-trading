import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const marketHolidaySchema = new Schema(
  {
    date: { type: Date, required: true, unique: true, index: true },
    description: { type: String, required: true },
    exchanges: [{ type: String, enum: ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS'] }],
  },
  { timestamps: true },
);

export type MarketHolidayDoc = InferSchemaType<typeof marketHolidaySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MarketHolidayModel: Model<MarketHolidayDoc> =
  (mongoose.models.MarketHoliday as Model<MarketHolidayDoc>) ||
  mongoose.model<MarketHolidayDoc>('MarketHoliday', marketHolidaySchema, 'marketHolidays');
