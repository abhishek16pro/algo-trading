import type { FastifyPluginAsync } from 'fastify';
import mongoose from 'mongoose';
import {
  BrokerAccountModel,
  InstrumentModel,
  OrderModel,
  PositionModel,
  StrategyModel,
  UserModel,
} from '@algo/db';
import { RedisKeys } from '@algo/redis-client';
import { NotFoundError } from '@algo/utils';

const SERVICES = [
  'api-gateway',
  'market-data',
  'execution-engine',
  'strategy-engine',
  'signal-service',
  'backtest-worker',
] as const;

const HEARTBEAT_STALE_MS = 15_000;

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  // ---------------------------------------------------------------- Service health
  app.get('/health', async () => {
    const now = Date.now();
    const services = await Promise.all(
      SERVICES.map(async (name) => {
        const h = await app.ctx.redis.hgetall(`service:heartbeat:${name}`);
        const ts = Number(h.ts ?? 0);
        const age = ts ? now - ts : null;
        return {
          name,
          status: !ts ? 'never-seen' : age! < HEARTBEAT_STALE_MS ? 'up' : 'down',
          lastSeenMs: ts || null,
          ageMs: age,
          pid: h.pid ? Number(h.pid) : null,
          uptimeSec: h.uptimeSec ? Number(h.uptimeSec) : null,
        };
      }),
    );
    const mongoUp = mongoose.connection.readyState === 1;
    let redisUp = false;
    try {
      redisUp = (await app.ctx.redis.ping()) === 'PONG';
    } catch {
      redisUp = false;
    }
    return {
      services,
      datastores: {
        mongo: { status: mongoUp ? 'up' : 'down' },
        redis: { status: redisUp ? 'up' : 'down' },
      },
      ts: now,
    };
  });

  // ---------------------------------------------------------------- Market-data status
  app.get('/market-data', async () => {
    const dbPrimary = await BrokerAccountModel.findOne({
      isPlatformPrimary: true,
      isActive: true,
      deletedAt: { $exists: false },
    }).lean();
    const envPrimaryId = app.ctx.cfg.ADMIN_BROKER_ACCOUNT_ID;
    const envPrimary = envPrimaryId ? await BrokerAccountModel.findById(envPrimaryId).lean() : null;
    const source = dbPrimary
      ? { type: 'db.isPlatformPrimary', account: dbPrimary }
      : envPrimary
        ? { type: 'env.ADMIN_BROKER_ACCOUNT_ID', account: envPrimary }
        : { type: 'fallback.mock', account: null };

    // Currently-subscribed tokens from the global set
    const tokens = await app.ctx.redis.smembers(RedisKeys.subsGlobal());
    const ticks = await Promise.all(
      tokens.map(async (t) => {
        const h = await app.ctx.redis.hgetall(RedisKeys.tickLast(t));
        const refcount = await app.ctx.redis.get(RedisKeys.subRefcount(t));
        const ts = Number(h.ts ?? 0);
        const ageMs = ts ? Date.now() - ts : null;
        return {
          token: t,
          ltp: h.ltp ? Number(h.ltp) : null,
          vol: h.vol ? Number(h.vol) : null,
          oi: h.oi ? Number(h.oi) : null,
          ts: ts || null,
          ageMs,
          fresh: ageMs !== null && ageMs < 10_000,
          refcount: refcount ? Number(refcount) : 0,
        };
      }),
    );
    ticks.sort((a, b) => a.token.localeCompare(b.token));

    return {
      source: {
        type: source.type,
        accountId: source.account ? String(source.account._id) : null,
        broker: source.account?.broker ?? null,
        label: source.account?.label ?? null,
        lastLoginAt: source.account?.lastLoginAt ?? null,
      },
      summary: {
        totalSubscriptions: ticks.length,
        freshTicks: ticks.filter((t) => t.fresh).length,
        staleTicks: ticks.filter((t) => !t.fresh).length,
      },
      ticks,
    };
  });

  // ---------------------------------------------------------------- Set platform primary broker
  app.post('/market-data/primary/:accountId', async (req) => {
    const { accountId } = req.params as { accountId: string };
    const acc = await BrokerAccountModel.findById(accountId);
    if (!acc) throw new NotFoundError('Broker account', accountId);
    if (!acc.isActive) {
      return { ok: false, message: 'Account is inactive — cannot make platform primary' };
    }
    // Demote any current primary
    await BrokerAccountModel.updateMany(
      { isPlatformPrimary: true },
      { $set: { isPlatformPrimary: false } },
    );
    acc.isPlatformPrimary = true;
    await acc.save();
    return {
      ok: true,
      message:
        'Platform market-data broker updated. Restart market-data-service for it to take effect ' +
        '(or wait for the next supervisor reconciliation).',
      accountId: String(acc._id),
      broker: acc.broker,
    };
  });

  // ---------------------------------------------------------------- Broker accounts (admin view: all users)
  app.get('/broker-accounts', async () => {
    const accs = await BrokerAccountModel.find({ deletedAt: { $exists: false } })
      .populate('userId', 'email name')
      .sort({ isPlatformPrimary: -1, createdAt: -1 })
      .lean();
    return accs.map((a) => ({
      id: String(a._id),
      broker: a.broker,
      label: a.label,
      isActive: a.isActive,
      isPrimary: a.isPrimary,
      isPlatformPrimary: Boolean((a as { isPlatformPrimary?: boolean }).isPlatformPrimary),
      user:
        a.userId && typeof a.userId === 'object'
          ? { email: (a.userId as unknown as { email: string }).email, name: (a.userId as unknown as { name: string }).name }
          : null,
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt,
    }));
  });

  // ---------------------------------------------------------------- Platform-wide stats
  app.get('/stats', async () => {
    const [users, brokers, instruments, strategies, runningStrategies, openOrders, openPositions] =
      await Promise.all([
        UserModel.countDocuments({ deletedAt: { $exists: false } }),
        BrokerAccountModel.countDocuments({ isActive: true, deletedAt: { $exists: false } }),
        InstrumentModel.estimatedDocumentCount(),
        StrategyModel.countDocuments({ deletedAt: { $exists: false } }),
        StrategyModel.countDocuments({ state: 'running', deletedAt: { $exists: false } }),
        OrderModel.countDocuments({ status: { $in: ['OPEN', 'PENDING', 'PARTIAL'] } }),
        PositionModel.countDocuments({ closedAt: { $exists: false } }),
      ]);
    return {
      users,
      brokers,
      instruments,
      strategies,
      runningStrategies,
      openOrders,
      openPositions,
    };
  });

  // ---------------------------------------------------------------- Subscriptions detail
  app.get('/subscriptions', async () => {
    const tokens = await app.ctx.redis.smembers(RedisKeys.subsGlobal());
    const out: Array<{ token: string; refcount: number }> = [];
    for (const t of tokens) {
      const r = await app.ctx.redis.get(RedisKeys.subRefcount(t));
      out.push({ token: t, refcount: r ? Number(r) : 0 });
    }
    out.sort((a, b) => b.refcount - a.refcount);
    return out;
  });
};
