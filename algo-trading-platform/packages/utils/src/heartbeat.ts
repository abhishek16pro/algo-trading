import type { Logger } from 'pino';

/**
 * Lightweight liveness heartbeat for every service. Each service calls `startHeartbeat()` once
 * on boot. Every 5 seconds it writes its status to a Redis hash under
 * `service:heartbeat:<name>`. The admin page reads these to render a service health grid.
 *
 * Fields written:
 *   ts        - last-heard epoch ms
 *   pid       - process id
 *   uptimeSec - seconds since service start
 *   status    - "up" (always — the fact that this write succeeded means the service is alive)
 *
 * The reader (admin route) considers a service "down" if its last `ts` is older than 15s.
 */

const INTERVAL_MS = 5_000;
const TTL_SEC = 30;

export type HeartbeatRedis = {
  hset: (key: string, fields: Record<string, string | number>) => Promise<unknown>;
  expire: (key: string, sec: number) => Promise<unknown>;
};

export function startHeartbeat(
  redis: HeartbeatRedis,
  service: string,
  log?: Logger,
): () => void {
  const startedAt = Date.now();

  const write = async (): Promise<void> => {
    try {
      const key = `service:heartbeat:${service}`;
      await redis.hset(key, {
        ts: Date.now(),
        pid: process.pid,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        status: 'up',
        service,
      });
      await redis.expire(key, TTL_SEC);
    } catch (err) {
      log?.warn({ err, service }, 'heartbeat write failed');
    }
  };

  // First write immediately so the admin page sees the service right away.
  void write();
  const timer = setInterval(() => void write(), INTERVAL_MS);
  return () => clearInterval(timer);
}
