import type { FastifyPluginAsync } from 'fastify';
import mongoose from 'mongoose';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => ({ ok: true, ts: Date.now() }));

  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, boolean> = {};
    checks.mongo = mongoose.connection.readyState === 1;
    try {
      const pong = await app.ctx.redis.ping();
      checks.redis = pong === 'PONG';
    } catch {
      checks.redis = false;
    }
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });
};
