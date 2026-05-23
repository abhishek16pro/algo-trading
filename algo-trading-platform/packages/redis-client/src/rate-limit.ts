import type { Redis } from 'ioredis';

/**
 * Sliding-window rate limiter using a Redis sorted set keyed on timestamps.
 *
 * Returns `{ allowed, remaining, resetMs }`. Allowed=false if the count for the past `windowMs`
 * would exceed `limit`.
 */
export type RateResult = { allowed: boolean; remaining: number; resetMs: number };

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
local count = redis.call("ZCARD", key)
if count >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local reset = window
  if #oldest >= 2 then reset = (tonumber(oldest[2]) + window) - now end
  return {0, 0, reset}
end
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window)
return {1, limit - count - 1, window}
`;

export async function checkRate(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateResult> {
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const r = (await redis.eval(SCRIPT, 1, key, now.toString(), windowMs.toString(), limit.toString(), member)) as [
    number,
    number,
    number,
  ];
  return { allowed: r[0] === 1, remaining: r[1], resetMs: r[2] };
}
