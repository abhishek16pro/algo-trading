import { connectMongo } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { createLogger, loadConfig } from '@algo/utils';
import { buildServer } from './server.js';
import { attachSocket } from './socket.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'api-gateway', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);
  const pub = createRedis(cfg.REDIS_URI, log);
  const sub = createRedis(cfg.REDIS_URI, log);
  const cmd = createRedis(cfg.REDIS_URI, log);
  const pubsub = new RedisPubSub(pub, sub, log);

  const app = await buildServer({ cfg, log, pubsub, redis: cmd });
  attachSocket(app.server, { cfg, log, pubsub });

  const port = cfg.PORT_API;
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'api-gateway listening');

  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal in api-gateway:', err);
  process.exit(1);
});
