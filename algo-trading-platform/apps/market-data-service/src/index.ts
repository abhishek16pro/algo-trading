import { connectMongo, BrokerAccountModel } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { createLogger, loadConfig } from '@algo/utils';
import { MarketDataService } from './service.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'market-data', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);

  const pub = createRedis(cfg.REDIS_URI, log);
  const sub = createRedis(cfg.REDIS_URI, log);
  const cmd = createRedis(cfg.REDIS_URI, log);
  const pubsub = new RedisPubSub(pub, sub, log);

  const svc = new MarketDataService({ log, redis: cmd, pubsub, defaultBroker: cfg.DEFAULT_BROKER });

  // Bootstrap: load active broker accounts
  const accounts = await BrokerAccountModel.find({ isActive: true, deletedAt: { $exists: false } }).lean();
  log.info({ count: accounts.length }, 'bootstrapping broker connections');
  for (const acc of accounts) {
    await svc.attachBroker({
      brokerAccountId: String(acc._id),
      broker: acc.broker as 'mock' | 'zerodha' | 'angelone' | 'upstox' | 'dhan' | 'fyers' | 'iifl',
      credentials: {},
    });
  }

  // If no real account exists in dev, attach a mock so the stack is usable.
  if (accounts.length === 0 && cfg.DEFAULT_BROKER === 'mock') {
    log.info('no broker accounts found — attaching dev mock broker');
    await svc.attachBroker({
      brokerAccountId: 'dev-mock',
      broker: 'mock',
      credentials: {},
    });
  }

  await svc.start();

  // Graceful shutdown
  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await svc.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal in market-data-service:', err);
  process.exit(1);
});
