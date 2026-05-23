import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import type { Redis } from 'ioredis';
import { AppError, type AppConfig, type Logger } from '@algo/utils';
import type { RedisPubSub } from '@algo/redis-client';
import { authRoutes } from './routes/auth.js';
import { brokerRoutes } from './routes/brokers.js';
import { instrumentRoutes } from './routes/instruments.js';
import { strategyRoutes } from './routes/strategies.js';
import { strategyPreviewRoutes } from './routes/strategy-preview.js';
import { signalRoutes } from './routes/signals.js';
import { orderRoutes } from './routes/orders.js';
import { positionRoutes } from './routes/positions.js';
import { backtestRoutes } from './routes/backtests.js';
import { marketDataRoutes } from './routes/market-data.js';
import { authPlugin } from './plugins/auth.js';
import { adminGuardPlugin } from './plugins/admin-guard.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { adminRoutes } from './routes/admin.js';
import { healthRoutes } from './routes/health.js';

export type AppContext = {
  cfg: AppConfig;
  log: Logger;
  pubsub: RedisPubSub;
  redis: Redis;
};

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fastifyOpts: any = {
    logger: ctx.log,
    trustProxy: true,
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  };
  const app: FastifyInstance = Fastify(fastifyOpts) as unknown as FastifyInstance;

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(sensible);
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    redis: ctx.redis as never,
    nameSpace: 'api-rate:',
  });

  // Decorate so handlers can grab the shared context off `app.ctx`.
  app.decorate('ctx', ctx);

  // Swagger MUST be registered before route plugins so it can capture their schemas.
  await app.register(swaggerPlugin);

  await app.register(authPlugin, { jwtSecret: ctx.cfg.JWT_ACCESS_SECRET, refreshSecret: ctx.cfg.JWT_REFRESH_SECRET });
  await app.register(adminGuardPlugin);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.message,
        details: err.details,
      });
    }
    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: err.message });
    }
    ctx.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Internal server error' });
  });

  // Routes
  await app.register(healthRoutes, { prefix: '/healthz' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(brokerRoutes, { prefix: '/api/v1/brokers' });
  await app.register(instrumentRoutes, { prefix: '/api/v1/instruments' });
  await app.register(strategyRoutes, { prefix: '/api/v1/strategies' });
  await app.register(strategyPreviewRoutes, { prefix: '/api/v1/strategies' });
  await app.register(signalRoutes, { prefix: '/api/v1/signals' });
  await app.register(orderRoutes, { prefix: '/api/v1/orders' });
  await app.register(positionRoutes, { prefix: '/api/v1/positions' });
  await app.register(backtestRoutes, { prefix: '/api/v1/backtests' });
  await app.register(marketDataRoutes, { prefix: '/api/v1/md' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    issueTokens: (payload: { sub: string; email: string }) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
  }
  interface FastifyRequest {
    user?: { userId: string; email: string };
  }
}
