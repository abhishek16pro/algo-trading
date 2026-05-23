import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Walks up from CWD looking for a `.env` file (or `.env.<NODE_ENV>`). Loads the first match.
 * Idempotent — calling it twice does not re-override existing process.env values.
 */
function loadDotenvFromNearest(): void {
  if (process.env.__ALGO_ENV_LOADED) return;
  let dir = process.cwd();
  const root = resolve(dir, '/');
  while (true) {
    const envFile = resolve(dir, '.env');
    if (existsSync(envFile) && statSync(envFile).isFile()) {
      dotenvConfig({ path: envFile });
      process.env.__ALGO_ENV_LOADED = '1';
      return;
    }
    const parent = dirname(dir);
    if (parent === dir || parent === root) return;
    dir = parent;
  }
}

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('Asia/Kolkata'),

  MONGO_URI: z.string().url().default('mongodb://localhost:27017/algotrade'),
  REDIS_URI: z.string().url().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  BROKER_ENC_KEY: z
    .string()
    .refine((s) => Buffer.from(s, 'base64').length === 32, {
      message: 'BROKER_ENC_KEY must be 32 bytes base64-encoded',
    }),

  ZERODHA_APP_ID: z.string().optional(),
  ANGELONE_API_KEY: z.string().optional(),
  UPSTOX_API_KEY: z.string().optional(),
  DHAN_CLIENT_ID: z.string().optional(),
  FYERS_APP_ID: z.string().optional(),

  PORT_API: z.coerce.number().int().positive().default(4000),
  PORT_MARKET_DATA: z.coerce.number().int().positive().default(4001),
  PORT_EXECUTION: z.coerce.number().int().positive().default(4002),
  PORT_STRATEGY: z.coerce.number().int().positive().default(4003),
  PORT_SIGNAL: z.coerce.number().int().positive().default(4004),

  DEFAULT_BROKER: z
    .enum(['mock', 'zerodha', 'angelone', 'upstox', 'dhan', 'fyers', 'iifl'])
    .default('mock'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type AppConfig = z.infer<typeof Env>;

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  loadDotenvFromNearest();
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigForTesting(): void {
  cached = undefined;
}
