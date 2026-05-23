import { Worker, type Job } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { connectMongo } from '@algo/db';
import { createLogger, loadConfig } from '@algo/utils';
import { runBacktest } from './run-backtest.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'backtest-worker', level: cfg.LOG_LEVEL });

  await connectMongo(cfg.MONGO_URI, log);

  // BullMQ requires maxRetriesPerRequest: null for the underlying connection.
  const connection = new IORedis(cfg.REDIS_URI, { maxRetriesPerRequest: null });

  const worker = new Worker(
    'backtest-run',
    async (job: Job<{ backtestId: string }>) => {
      log.info({ jobId: job.id, backtestId: job.data.backtestId }, 'starting backtest');
      await runBacktest(job.data.backtestId, log, async (p) => job.updateProgress(p));
      log.info({ jobId: job.id }, 'backtest done');
    },
    { connection, concurrency: 4 },
  );

  worker.on('failed', (job, err) =>
    log.error({ jobId: job?.id, err: err.message }, 'backtest failed'),
  );

  log.info('backtest-worker listening on queue backtest-run');

  const shutdown = async (sig: string): Promise<void> => {
    log.warn({ sig }, 'shutdown requested');
    await worker.close();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal in backtest-worker:', err);
  process.exit(1);
});
