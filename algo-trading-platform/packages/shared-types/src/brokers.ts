import { z } from 'zod';

export const BrokerIdSchema = z.enum([
  'mock',
  'zerodha',
  'angelone',
  'upstox',
  'dhan',
  'fyers',
  'iifl',
  'motilal',
]);
export type BrokerId = z.infer<typeof BrokerIdSchema>;

export const BrokerCredentialsSchema = z.object({
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  clientCode: z.string().optional(),
  password: z.string().optional(),
  totpSecret: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  accessTokenExpiry: z.coerce.date().optional(),
  // Motilal-specific
  vendorInfo: z.string().optional(),
  twoFA: z.string().optional(), // PAN or DOB "DD/MM/YYYY"
});
export type BrokerCredentials = z.infer<typeof BrokerCredentialsSchema>;

export type BrokerProfile = {
  clientCode: string;
  name?: string;
  email?: string;
  exchanges?: string[];
  products?: string[];
  segments?: string[];
  userType?: string;
  broker: BrokerId;
};

export const BrokerCapabilitiesSchema = z.object({
  canTradeEquity: z.boolean().default(true),
  canTradeFNO: z.boolean().default(true),
  canTradeMCX: z.boolean().default(false),
  maxWSSubscriptions: z.number().int().positive().default(1000),
  supportsBracketOrder: z.boolean().default(false),
  supportsCoverOrder: z.boolean().default(false),
});
export type BrokerCapabilities = z.infer<typeof BrokerCapabilitiesSchema>;

export type BrokerLoginResult = {
  accessToken: string;
  refreshToken?: string;
  expiry: Date;
};
