import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AuthError } from '@algo/utils';
import { RedisKeys } from '@algo/redis-client';

type Options = { jwtSecret: string; refreshSecret: string };

const authPluginImpl: FastifyPluginAsync<Options> = async (app: FastifyInstance, opts) => {
  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new AuthError('Missing bearer token');
    const token = auth.slice('Bearer '.length).trim();
    try {
      const decoded = jwt.verify(token, opts.jwtSecret) as { sub: string; email: string };
      req.user = { userId: decoded.sub, email: decoded.email };
    } catch {
      throw new AuthError('Invalid or expired token');
    }
  });

  app.decorate(
    'issueTokens',
    async (payload: { sub: string; email: string }) => {
      const accessToken = jwt.sign(payload, opts.jwtSecret, { expiresIn: '15m' });
      const jti = randomUUID();
      const refreshToken = jwt.sign({ ...payload, jti }, opts.refreshSecret, { expiresIn: '7d' });
      // Whitelist the jti so refresh can be revoked.
      await app.ctx.redis.set(
        RedisKeys.refreshTokenWhitelist(payload.sub, jti),
        '1',
        'EX',
        7 * 24 * 3600,
      );
      return { accessToken, refreshToken, expiresIn: 15 * 60 };
    },
  );
};

export const authPlugin = fp(authPluginImpl, {
  name: 'algo-auth',
});
