import { connectMongo, BrokerAccountModel, InstrumentModel } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { channels, type BrokerCredentials, type BrokerId } from '@algo/shared-types';
import { createLogger, decrypt, loadConfig, startHeartbeat } from '@algo/utils';
import { MarketDataService } from './service.js';

/** Indices the platform always streams once the admin broker is up. */
const ADMIN_INDEX_SUBSCRIPTIONS = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY'] as const;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'market-data', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);

  const pub = createRedis(cfg.REDIS_URI, log);
  const sub = createRedis(cfg.REDIS_URI, log);
  const cmd = createRedis(cfg.REDIS_URI, log);
  const pubsub = new RedisPubSub(pub, sub, log);

  const svc = new MarketDataService({ log, redis: cmd, pubsub, defaultBroker: cfg.DEFAULT_BROKER });

  // ARCHITECTURE: market-data-service is the SINGLE source of broker tick streams for the entire
  // platform. It connects to exactly ONE broker — the admin/platform broker — and fans the ticks
  // out via Redis pub/sub. Per-user brokers are NEVER attached here; those live in the execution-
  // engine and are only touched when that user actually places an order.
  //
  // Why: if every user's broker were attached, we'd open N WebSockets and receive N duplicate
  // tick streams for the same instruments — corrupting candle volume, paper sim, and signals.
  let attached = false;

  // Prefer DB-driven choice (admin clicked "Set as platform market-data" in /admin UI), fall back
  // to env-driven ADMIN_BROKER_ACCOUNT_ID, fall back to mock in dev.
  const dbPrimary = await BrokerAccountModel.findOne({
    isPlatformPrimary: true,
    isActive: true,
    deletedAt: { $exists: false },
  }).lean();
  const adminId = dbPrimary ? String(dbPrimary._id) : cfg.ADMIN_BROKER_ACCOUNT_ID;

  if (adminId) {
    const admin = dbPrimary ?? (await BrokerAccountModel.findById(adminId).lean());
    if (admin && admin.isActive) {
      const creds = decryptCreds(admin.credentials ?? {}, cfg.BROKER_ENC_KEY);
      try {
        await svc.attachBroker({
          brokerAccountId: String(admin._id),
          broker: admin.broker as BrokerId,
          credentials: creds,
        });
        log.info(
          {
            broker: admin.broker,
            accountId: String(admin._id),
            userId: String(admin.userId),
            source: dbPrimary ? 'db.isPlatformPrimary' : 'env.ADMIN_BROKER_ACCOUNT_ID',
          },
          'admin broker attached — sole market-data source',
        );
        attached = true;
      } catch (err) {
        log.error({ err }, 'failed to attach admin broker');
      }
    } else {
      log.error(
        { ADMIN_BROKER_ACCOUNT_ID: cfg.ADMIN_BROKER_ACCOUNT_ID },
        'ADMIN_BROKER_ACCOUNT_ID set but the account is missing or inactive in Mongo',
      );
    }
  }

  // Dev fallback: if no admin broker is configured, spin up the mock so the stack still runs.
  if (!attached && cfg.DEFAULT_BROKER === 'mock') {
    log.warn(
      'No ADMIN_BROKER_ACCOUNT_ID configured — falling back to mock broker for dev. ' +
        'Set ADMIN_BROKER_ACCOUNT_ID in .env to use real broker market data.',
    );
    await svc.attachBroker({ brokerAccountId: 'dev-mock', broker: 'mock', credentials: {} });
    attached = true;
  }

  if (!attached) {
    log.fatal(
      'No market data source. Set ADMIN_BROKER_ACCOUNT_ID in .env to a connected broker account, ' +
        'or set DEFAULT_BROKER=mock for dev.',
    );
    process.exit(1);
  }

  await svc.start();

  startHeartbeat(cmd, 'market-data', log);

  // 4. Always-on index subscriptions (admin broker is the authoritative tick source).
  //    We resolve the canonical token for each index from the contract master and publish a
  //    standard subscription request — the service ref-counts so user strategies just piggyback.
  await ensureIndexSubscriptions(pubsub, log);

  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await svc.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function decryptCreds(
  enc: Record<string, unknown>,
  key: string,
): BrokerCredentials {
  const out: BrokerCredentials = {};
  for (const k of [
    'apiKey',
    'apiSecret',
    'clientCode',
    'password',
    'totpSecret',
    'accessToken',
    'refreshToken',
    'vendorInfo',
    'twoFA',
  ] as const) {
    const v = enc[k];
    if (typeof v === 'string' && v.length > 0) {
      try {
        (out as Record<string, string>)[k] = decrypt(v, key);
      } catch {
        // Either plaintext (legacy) or corrupt — leave undefined and continue.
      }
    }
  }
  if (enc.accessTokenExpiry instanceof Date) out.accessTokenExpiry = enc.accessTokenExpiry;
  return out;
}

async function ensureIndexSubscriptions(
  pubsub: RedisPubSub,
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): Promise<void> {
  const tokens: string[] = [];
  for (const underlying of ADMIN_INDEX_SUBSCRIPTIONS) {
    const ins = await InstrumentModel.findOne({ underlying, instrumentType: 'IDX' }).lean();
    if (ins) tokens.push(ins.instrumentToken);
    else log.warn({ underlying }, 'index instrument not found in contract master');
  }
  if (tokens.length === 0) return;
  await pubsub.publish(channels.subscriptionRequest, {
    action: 'subscribe',
    tokens,
    mode: 'quote',
    requesterId: 'admin:indices',
  });
  log.info({ count: tokens.length, tokens }, 'admin index subscriptions established');
}

main().catch((err) => {
  console.error('Fatal in market-data-service:', err);
  process.exit(1);
});
