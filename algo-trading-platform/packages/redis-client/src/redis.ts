import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from '@algo/utils';

export type RedisClient = Redis;

export function createRedis(uri: string, log?: Logger, opts: RedisOptions = {}): Redis {
  const client = new Redis(uri, {
    maxRetriesPerRequest: null,
    // Managed Redis providers (Upstash, Redis Cloud free) restrict admin commands like INFO
    // on user connections. Disable ready check so ioredis doesn't run INFO at startup.
    enableReadyCheck: false,
    lazyConnect: false,
    reconnectOnError: () => 1,
    ...opts,
  });

  client.on('connect', () => log?.info('redis connected'));
  client.on('ready', () => log?.debug('redis ready'));
  client.on('error', (err) => log?.error({ err: err.message }, 'redis error'));
  client.on('close', () => log?.warn('redis closed'));
  client.on('reconnecting', (ms: number) => log?.warn({ ms }, 'redis reconnecting'));

  return client;
}

export async function closeRedis(client: Redis): Promise<void> {
  if (client.status === 'end') return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
