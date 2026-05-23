import { connectMongo, BrokerAccountModel, InstrumentModel } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { channels, type BrokerCredentials, type BrokerId } from '@algo/shared-types';
import { createLogger, decrypt, loadConfig } from '@algo/utils';
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

  // 1. Bootstrap broker connections. If ADMIN_BROKER_ACCOUNT_ID is set, prefer that one.
  let adminAccountId: string | undefined;
  if (cfg.ADMIN_BROKER_ACCOUNT_ID) {
    const admin = await BrokerAccountModel.findById(cfg.ADMIN_BROKER_ACCOUNT_ID).lean();
    if (admin && admin.isActive) {
      adminAccountId = String(admin._id);
      const creds = decryptCreds(admin.credentials ?? {}, cfg.BROKER_ENC_KEY);
      try {
        await svc.attachBroker({
          brokerAccountId: adminAccountId,
          broker: admin.broker as BrokerId,
          credentials: creds,
        });
        log.info({ broker: admin.broker, accountId: adminAccountId }, 'admin broker attached');
      } catch (err) {
        log.error({ err }, 'failed to attach admin broker — falling back');
      }
    } else {
      log.warn({ ADMIN_BROKER_ACCOUNT_ID: cfg.ADMIN_BROKER_ACCOUNT_ID }, 'admin broker not found or inactive');
    }
  }

  // 2. Attach remaining active accounts (these are used for per-user order placement).
  const others = await BrokerAccountModel.find({
    isActive: true,
    deletedAt: { $exists: false },
    _id: { $ne: adminAccountId },
  }).lean();
  log.info({ count: others.length }, 'attaching additional broker accounts');
  for (const acc of others) {
    const creds = decryptCreds(acc.credentials ?? {}, cfg.BROKER_ENC_KEY);
    try {
      await svc.attachBroker({
        brokerAccountId: String(acc._id),
        broker: acc.broker as BrokerId,
        credentials: creds,
      });
    } catch (err) {
      log.warn({ err, broker: acc.broker }, 'failed to attach broker — skipping');
    }
  }

  // 3. Dev fallback: spin up a mock if nothing else attached.
  if (!adminAccountId && others.length === 0 && cfg.DEFAULT_BROKER === 'mock') {
    log.info('no broker accounts in DB — attaching dev mock broker');
    await svc.attachBroker({ brokerAccountId: 'dev-mock', broker: 'mock', credentials: {} });
  }

  await svc.start();

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
