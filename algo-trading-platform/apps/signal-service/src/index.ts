import { connectMongo } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { createLogger, loadConfig } from '@algo/utils';
import { SignalService } from './service.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'signal-service', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);
  const pub = createRedis(cfg.REDIS_URI, log);
  const sub = createRedis(cfg.REDIS_URI, log);
  const pubsub = new RedisPubSub(pub, sub, log);

  const svc = new SignalService({ log, pubsub });
  await svc.start();

  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await svc.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal in signal-service:', err);
  process.exit(1);
});
