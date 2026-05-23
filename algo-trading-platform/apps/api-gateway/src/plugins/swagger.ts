import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/**
 * OpenAPI 3 + Swagger UI for the api-gateway.
 *
 *   - JSON spec at /docs/json
 *   - Interactive Swagger UI at /docs
 *
 * Routes don't have JSON Schemas attached today, so the generated spec captures HTTP methods +
 * paths + tags. Authorization works: paste `Bearer <accessToken>` into the Swagger "Authorize"
 * dialog (top right) and you can hit any protected route. Get a token first via POST /auth/login.
 */
const swaggerPluginImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(swagger, {
    /**
     * Auto-tag routes by URL prefix so we don't have to repeat tags on every handler.
     * Also mark all /api/v1/* routes as bearer-secured except /auth/login + /auth/register.
     */
    transform: (({ schema, url }: { schema: Record<string, unknown> | undefined; url: string }) => {
      const tag = inferTag(url);
      const s: Record<string, unknown> = { ...(schema ?? {}) };
      if (tag && !s.tags) s.tags = [tag];
      const open =
        url === '/api/v1/auth/login' ||
        url === '/api/v1/auth/register' ||
        url === '/api/v1/auth/refresh' ||
        url === '/healthz' ||
        url === '/healthz/ready';
      if (!open && url.startsWith('/api/v1/') && !s.security) {
        s.security = [{ bearerAuth: [] }];
      }
      return { schema: s, url };
    }) as never,
    openapi: {
      info: {
        title: 'Algo Trading Platform API',
        description:
          'REST surface for the multi-broker Indian algo trading platform. ' +
          'All routes under /api/v1/* require a Bearer JWT (obtain via POST /api/v1/auth/login).',
        version: '0.1.0',
      },
      servers: [
        { url: 'http://localhost:4000', description: 'Local dev' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'auth', description: 'Register, login, refresh, logout, me' },
        { name: 'brokers', description: 'Connect broker accounts; fetch profile + margin' },
        { name: 'strategies', description: 'CRUD + deploy / pause / stop strategies' },
        { name: 'signals', description: 'Indicator-based signal blocks' },
        { name: 'orders', description: 'Manual order placement, modify, cancel' },
        { name: 'positions', description: 'Open positions, square-off' },
        { name: 'instruments', description: 'Contract master search + options chain' },
        { name: 'backtests', description: 'Enqueue backtest, read results' },
        { name: 'market-data', description: 'Quotes from Redis + historical candles' },
        { name: 'health', description: 'Liveness + readiness' },
        { name: 'admin', description: 'Service status, market-data control (admin role only)' },
      ],
    },
    hideUntagged: false,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });
};

export const swaggerPlugin = fp(swaggerPluginImpl, { name: 'algo-swagger' });

function inferTag(url: string): string | null {
  if (url.startsWith('/healthz')) return 'health';
  if (url.startsWith('/api/v1/auth')) return 'auth';
  if (url.startsWith('/api/v1/brokers')) return 'brokers';
  if (url.startsWith('/api/v1/strategies')) return 'strategies';
  if (url.startsWith('/api/v1/signals')) return 'signals';
  if (url.startsWith('/api/v1/orders')) return 'orders';
  if (url.startsWith('/api/v1/positions')) return 'positions';
  if (url.startsWith('/api/v1/instruments')) return 'instruments';
  if (url.startsWith('/api/v1/backtests')) return 'backtests';
  if (url.startsWith('/api/v1/md')) return 'market-data';
  if (url.startsWith('/api/v1/admin')) return 'admin';
  return null;
}
