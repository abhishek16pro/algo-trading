import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel } from '@algo/db';
import { LoginRequestSchema, RegisterRequestSchema } from '@algo/shared-types';
import { AuthError, ConflictError } from '@algo/utils';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Register a new user',
        body: {
          type: 'object',
          required: ['email', 'password', 'name'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            name: { type: 'string', minLength: 1 },
            phone: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              user: { type: 'object' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'number' },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const body = RegisterRequestSchema.parse(req.body);
      const exists = await UserModel.findOne({ email: body.email }).lean();
      if (exists) throw new ConflictError('Email already registered');

      const passwordHash = await bcrypt.hash(body.password, 12);
      const user = await UserModel.create({
        email: body.email,
        passwordHash,
        name: body.name,
        phone: body.phone,
      });

      const tokens = await app.issueTokens({ sub: String(user._id), email: user.email });
      return reply.code(201).send({ user: user.toJSON(), ...tokens });
    },
  );

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log in with email + password',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', examples: ['demo@algotrade.local'] },
            password: { type: 'string', examples: ['demo1234'] },
            totp: { type: 'string', minLength: 6, maxLength: 6 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              expiresIn: { type: 'number' },
            },
          },
        },
      },
    },
    async (req) => {
      const body = LoginRequestSchema.parse(req.body);
      const user = await UserModel.findOne({ email: body.email });
      if (!user) throw new AuthError('Invalid credentials');
      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) throw new AuthError('Invalid credentials');
      return app.issueTokens({ sub: String(user._id), email: user.email });
    },
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange a refresh token for a new access token',
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        },
      },
    },
    async (req) => {
      const body = req.body as { refreshToken?: string };
      if (!body?.refreshToken) throw new AuthError('Missing refresh token');
      let decoded: { sub: string; email: string; jti?: string };
      try {
        decoded = jwt.verify(body.refreshToken, app.ctx.cfg.JWT_REFRESH_SECRET) as never;
      } catch {
        throw new AuthError('Invalid refresh token');
      }
      if (decoded.jti) {
        const ok = await app.ctx.redis.get(`refresh:${decoded.sub}:${decoded.jti}`);
        if (!ok) throw new AuthError('Refresh token revoked');
        await app.ctx.redis.del(`refresh:${decoded.sub}:${decoded.jti}`);
      }
      return app.issueTokens({ sub: decoded.sub, email: decoded.email });
    },
  );

  app.post(
    '/logout',
    {
      preHandler: app.authenticate,
      schema: { tags: ['auth'], summary: 'Revoke all refresh tokens for current user', security: [{ bearerAuth: [] }] },
    },
    async (req) => {
      const userId = req.user!.userId;
      const keys = await app.ctx.redis.keys(`refresh:${userId}:*`);
      if (keys.length > 0) await app.ctx.redis.del(...keys);
      return { ok: true };
    },
  );

  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: { tags: ['auth'], summary: 'Get the currently authenticated user', security: [{ bearerAuth: [] }] },
    },
    async (req) => {
      const u = await UserModel.findById(req.user!.userId);
      if (!u) throw new AuthError('User not found');
      return u.toJSON();
    },
  );
};
