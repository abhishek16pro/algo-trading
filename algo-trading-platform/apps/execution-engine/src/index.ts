import { connectMongo } from '@algo/db';
import { createRedis, RedisPubSub } from '@algo/redis-client';
import { createLogger, loadConfig } from '@algo/utils';
import { ExecutionEngine } from './engine.js';
import { AdapterRegistry } from './adapter-registry.js';
import { ExecListener } from './exec-listener.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'execution-engine', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);
  const pub = createRedis(cfg.REDIS_URI, log);
  const sub = createRedis(cfg.REDIS_URI, log);
  const cmd = createRedis(cfg.REDIS_URI, log);
  const pubsub = new RedisPubSub(pub, sub, log);

  const registry = new AdapterRegistry(log, cfg.BROKER_ENC_KEY);
  const engine = new ExecutionEngine({ log, redis: cmd, pubsub, registry, defaultBroker: cfg.DEFAULT_BROKER });

  await engine.start();

  const listener = new ExecListener(log, pubsub, engine);
  await listener.start();

  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await engine.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal in execution-engine:', err);
  process.exit(1);
});
