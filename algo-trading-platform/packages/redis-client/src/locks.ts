import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';

/**
 * Minimal Redlock single-instance implementation — sufficient for app-level mutual exclusion
 * inside one Redis. For multi-AZ correctness, swap in `redlock` npm package.
 */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const EXTEND_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export type Lock = {
  key: string;
  value: string;
  release: () => Promise<boolean>;
  extend: (ttlMs: number) => Promise<boolean>;
};

export async function acquireLock(
  redis: Redis,
  key: string,
  ttlMs: number,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<Lock | null> {
  const { retries = 0, retryDelayMs = 50 } = opts;
  const value = randomBytes(16).toString('hex');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ok = await redis.set(key, value, 'PX', ttlMs, 'NX');
    if (ok === 'OK') {
      return {
        key,
        value,
        release: async () => {
          const r = await redis.eval(RELEASE_LUA, 1, key, value);
          return r === 1;
        },
        extend: async (newTtl) => {
          const r = await redis.eval(EXTEND_LUA, 1, key, value, newTtl.toString());
          return r === 1;
        },
      };
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  return null;
}

/** Convenience: run a critical section under a lock; releases automatically. */
export async function withLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lock = await acquireLock(redis, key, ttlMs);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await lock.release().catch(() => undefined);
  }
}
