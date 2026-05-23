import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BrokerAccountModel, type BrokerAccountDoc } from '@algo/db';
import { createAdapter, type IBrokerAdapter } from '@algo/broker-adapters';
import {
  BrokerCredentialsSchema,
  BrokerIdSchema,
  type BrokerCredentials,
  type BrokerId,
} from '@algo/shared-types';
import { decrypt, encrypt, NotFoundError, ForbiddenError, AppError } from '@algo/utils';

const CreateSchema = z.object({
  broker: BrokerIdSchema,
  label: z.string().min(1).max(50),
  credentials: BrokerCredentialsSchema,
  isPrimary: z.boolean().optional(),
});

/** Per-request, short-lived adapter cache so a single hop doesn't re-auth twice. */
const REQUEST_ADAPTER_CACHE: WeakMap<object, Map<string, IBrokerAdapter>> = new WeakMap();

export const brokerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async () => {
    return [
      { id: 'motilal', name: 'Motilal Oswal', capabilities: { canTradeEquity: true, canTradeFNO: true, canTradeMCX: true } },
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

    // 1. Verify creds by attempting a real login + profile fetch. If this fails, refuse to save.
    let verifiedProfile: { clientCode: string; name?: string } | undefined;
    let issuedTokens: { accessToken?: string; refreshToken?: string } = {};
    if (body.broker !== 'mock') {
      const adapter = createAdapter(body.broker, {
        brokerAccountId: 'pending',
        credentials: body.credentials,
      });
      try {
        const result = await adapter.login(body.credentials);
        issuedTokens = { accessToken: result.accessToken, refreshToken: result.refreshToken };
        const profile = await adapter.getProfile();
        verifiedProfile = { clientCode: profile.clientCode, name: profile.name };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'broker login failed';
        throw new AppError(`Broker verification failed: ${msg}`, 400, 'BROKER_VERIFICATION_FAILED');
      }
    } else {
      verifiedProfile = { clientCode: 'MOCK001', name: 'Mock User' };
    }

    // 2. Encrypt credentials + freshly minted tokens.
    const enc: Record<string, string | Date | undefined> = {};
    for (const k of [
      'apiKey',
      'apiSecret',
      'clientCode',
      'password',
      'totpSecret',
      'vendorInfo',
      'twoFA',
    ] as const) {
      const v = body.credentials[k];
      if (v) enc[k] = encrypt(v, encKey);
    }
    if (issuedTokens.accessToken) enc.accessToken = encrypt(issuedTokens.accessToken, encKey);
    if (issuedTokens.refreshToken) enc.refreshToken = encrypt(issuedTokens.refreshToken, encKey);

    // 3. If user requested primary, demote previous primary first.
    if (body.isPrimary) {
      await BrokerAccountModel.updateMany(
        { userId: req.user!.userId, isPrimary: true },
        { $set: { isPrimary: false } },
      );
    }

    const acc = await BrokerAccountModel.create({
      userId: req.user!.userId,
      broker: body.broker,
      label: body.label,
      credentials: enc,
      isActive: true,
      isPrimary: Boolean(body.isPrimary),
      lastLoginAt: new Date(),
    });

    return reply.code(201).send({
      id: String(acc._id),
      profile: verifiedProfile,
    });
  });

  app.post('/accounts/:id/set-primary', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    await BrokerAccountModel.updateMany(
      { userId: req.user!.userId, isPrimary: true },
      { $set: { isPrimary: false } },
    );
    acc.isPrimary = true;
    await acc.save();
    return { ok: true };
  });

  app.delete('/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    acc.deletedAt = new Date();
    acc.isActive = false;
    await acc.save();
    return { ok: true };
  });

  // ----------------------------------------------------- Account info routes
  app.get('/accounts/:id/profile', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    const adapter = await adapterFor(acc, app.ctx.cfg.BROKER_ENC_KEY, req);
    return adapter.getProfile();
  });

  app.get('/accounts/:id/funds', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    const adapter = await adapterFor(acc, app.ctx.cfg.BROKER_ENC_KEY, req);
    return adapter.getFunds();
  });

  app.get('/accounts/:id/positions', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    const adapter = await adapterFor(acc, app.ctx.cfg.BROKER_ENC_KEY, req);
    return adapter.getPositions();
  });

  app.get('/accounts/:id/holdings', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    const adapter = await adapterFor(acc, app.ctx.cfg.BROKER_ENC_KEY, req);
    return adapter.getHoldings();
  });

  app.get('/accounts/:id/orderbook', async (req) => {
    const { id } = req.params as { id: string };
    const acc = await ownedAccount(req.user!.userId, id);
    const adapter = await adapterFor(acc, app.ctx.cfg.BROKER_ENC_KEY, req);
    return adapter.getOrderBook();
  });
};

async function ownedAccount(userId: string, id: string): Promise<BrokerAccountDoc> {
  const acc = await BrokerAccountModel.findById(id);
  if (!acc) throw new NotFoundError('Broker account', id);
  if (String(acc.userId) !== userId) throw new ForbiddenError();
  return acc;
}

async function adapterFor(
  acc: BrokerAccountDoc,
  encKey: string,
  req: object,
): Promise<IBrokerAdapter> {
  let cache = REQUEST_ADAPTER_CACHE.get(req);
  if (!cache) {
    cache = new Map();
    REQUEST_ADAPTER_CACHE.set(req, cache);
  }
  const key = String(acc._id);
  const cached = cache.get(key);
  if (cached) return cached;
  const creds = decryptCredentials(acc.credentials as Record<string, unknown>, encKey);
  const adapter = createAdapter(acc.broker as BrokerId, {
    brokerAccountId: key,
    credentials: creds,
  });
  cache.set(key, adapter);
  return adapter;
}

function decryptCredentials(enc: Record<string, unknown>, key: string): BrokerCredentials {
  const out: BrokerCredentials = {};
  for (const k of [
    'apiKey',
    'apiSecret',
    'clientCode',
    'password',
    'totpSecret',
    'accessToken',
    'refreshToken',
    'vendorInfo',
    'twoFA',
  ] as const) {
    const v = enc[k];
    if (typeof v === 'string' && v.length > 0) {
      try {
        (out as Record<string, string>)[k] = decrypt(v, key);
      } catch {
        // Plain or corrupt; skip.
      }
    }
  }
  return out;
}
