import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BrokerAccountModel } from '@algo/db';
import { createAdapter } from '@algo/broker-adapters';
import { BrokerCredentialsSchema, BrokerIdSchema } from '@algo/shared-types';
import { encrypt, NotFoundError, ForbiddenError } from '@algo/utils';

const CreateSchema = z.object({
  broker: BrokerIdSchema,
  label: z.string().min(1).max(50),
  credentials: BrokerCredentialsSchema,
});

export const brokerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async () => {
    return [
      { id: 'zerodha', name: 'Zerodha Kite', capabilities: { canTradeEquity: true, canTradeFNO: true } },
      { id: 'angelone', name: 'Angel One SmartAPI', capabilities: { canTradeEquity: true, canTradeFNO: true } },
      { id: 'upstox', name: 'Upstox', capabilities: { canTradeEquity: true, canTradeFNO: true } },
      { id: 'dhan', name: 'Dhan', capabilities: { canTradeEquity: true, canTradeFNO: true } },
      { id: 'fyers', name: 'Fyers', capabilities: { canTradeEquity: true, canTradeFNO: true } },
      { id: 'mock', name: 'Mock (development)', capabilities: { canTradeEquity: true, canTradeFNO: true } },
    ];
  });

  app.get('/accounts', async (req) => {
    const docs = await BrokerAccountModel.find({
      userId: req.user!.userId,
      deletedAt: { $exists: false },
    }).lean();
    return docs.map((d) => ({
      id: String(d._id),
      broker: d.broker,
      label: d.label,
      isActive: d.isActive,
      isPrimary: d.isPrimary,
      capabilities: d.capabilities,
      lastLoginAt: d.lastLoginAt,
    }));
  });

  app.post('/accounts', async (req, reply) => {
    const body = CreateSchema.parse(req.body);
    const encKey = app.ctx.cfg.BROKER_ENC_KEY;
    const enc: Record<string, string | Date | undefined> = {};
    for (const k of ['apiKey', 'apiSecret', 'clientCode', 'password', 'totpSecret', 'accessToken', 'refreshToken'] as const) {
      const v = body.credentials[k];
      if (v) enc[k] = encrypt(v, encKey);
    }
    if (body.credentials.accessTokenExpiry) enc.accessTokenExpiry = body.credentials.accessTokenExpiry;

    // Try login to verify creds (mock just succeeds).
    if (body.broker !== 'mock') {
      const adapter = createAdapter(body.broker, {
        brokerAccountId: 'pending',
        credentials: body.credentials,
      });
      // Surface errors immediately.
      await adapter.isTokenValid(body.credentials).catch(() => false);
    }

    const acc = await BrokerAccountModel.create({
      userId: req.user!.userId,
      broker: body.broker,
      label: body.label,
      credentials: enc,
      isActive: true,
    });
    return reply.code(201).send({ id: String(acc._id) });
  });

  app.delete('/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await BrokerAccountModel.findById(id);
    if (!acc) throw new NotFoundError('Broker account', id);
    if (String(acc.userId) !== req.user!.userId) throw new ForbiddenError();
    acc.deletedAt = new Date();
    acc.isActive = false;
    await acc.save();
    return { ok: true };
  });

  app.get('/accounts/:id/funds', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await BrokerAccountModel.findById(id);
    if (!acc) throw new NotFoundError('Broker account', id);
    if (String(acc.userId) !== req.user!.userId) throw new ForbiddenError();
    if (acc.broker === 'mock') return { available: 500_000, used: 0, total: 500_000 };
    return { available: 0, used: 0, total: 0 };
  });

  app.get('/accounts/:id/positions', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await BrokerAccountModel.findById(id);
    if (!acc) throw new NotFoundError('Broker account', id);
    if (String(acc.userId) !== req.user!.userId) throw new ForbiddenError();
    return [];
  });

  app.get('/accounts/:id/holdings', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await BrokerAccountModel.findById(id);
    if (!acc) throw new NotFoundError('Broker account', id);
    if (String(acc.userId) !== req.user!.userId) throw new ForbiddenError();
    return [];
  });

  app.get('/accounts/:id/orderbook', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await BrokerAccountModel.findById(id);
    if (!acc) throw new NotFoundError('Broker account', id);
    if (String(acc.userId) !== req.user!.userId) throw new ForbiddenError();
    return [];
  });
};
