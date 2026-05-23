import { connectMongo } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { createLogger, loadConfig, startHeartbeat } from '@algo/utils';
import { Supervisor } from './supervisor.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'strategy-engine', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);
  const pub = createRedis(cfg.REDIS_URI, log);
  const sub = createRedis(cfg.REDIS_URI, log);
  const cmd = createRedis(cfg.REDIS_URI, log);
  const pubsub = new RedisPubSub(pub, sub, log);

  const supervisor = new Supervisor({ log, redis: cmd, pubsub });
  await supervisor.start();

  startHeartbeat(cmd, 'strategy-engine', log);

  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await supervisor.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal in strategy-engine:', err);
  process.exit(1);
});
