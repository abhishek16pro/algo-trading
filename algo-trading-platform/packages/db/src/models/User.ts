import mongoose, { Schema, type InferSchemaType, type Model, type HydratedDocument } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String },
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String },
    },
    preferences: {
      defaultBroker: { type: String },
      defaultProductType: { type: String, enum: ['MIS', 'NRML', 'CNC'], default: 'MIS' },
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform(_doc, ret: Record<string, unknown>) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    const tf = ret.twoFactor as { secret?: string } | undefined;
    if (tf) delete tf.secret;
    return ret;
  },
});

type UserSchemaType = InferSchemaType<typeof userSchema>;
export type UserLean = UserSchemaType & { _id: mongoose.Types.ObjectId };
export type UserDoc = HydratedDocument<UserSchemaType>;

export const UserModel: Model<UserSchemaType> =
  (mongoose.models.User as Model<UserSchemaType>) ||
  mongoose.model<UserSchemaType>('User', userSchema, 'users');
