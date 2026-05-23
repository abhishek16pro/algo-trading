import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { UserModel } from '@algo/db';
import { ForbiddenError } from '@algo/utils';

/**
 * Decorates the Fastify instance with `requireAdmin` — a preHandler that returns 403 if the
 * current user's `role` is not `admin`. Must run AFTER `authenticate`.
 *
 * Usage on a route group:
 *   app.addHook('preHandler', app.authenticate);
 *   app.addHook('preHandler', app.requireAdmin);
 */
const adminGuardImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorate('requireAdmin', async (req: import('fastify').FastifyRequest) => {
    if (!req.user) throw new ForbiddenError('Not authenticated');
    const u = await UserModel.findById(req.user.userId).select('role').lean();
    if (!u || u.role !== 'admin') {
      throw new ForbiddenError('Admin role required');
    }
  });
};

export const adminGuardPlugin = fp(adminGuardImpl, { name: 'algo-admin-guard' });

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (req: import('fastify').FastifyRequest) => Promise<void>;
  }
}
