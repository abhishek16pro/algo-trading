import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { z } from 'zod';
import { BacktestModel } from '@algo/db';
import { BacktestRequestSchema } from '@algo/shared-types';
import { ForbiddenError, NotFoundError } from '@algo/utils';

const ListSchema = z.object({
  strategyId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const backtestRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  const conn = new IORedis(app.ctx.cfg.REDIS_URI, { maxRetriesPerRequest: null });
  const queue = new Queue('backtest-run', { connection: conn });

  app.addHook('onClose', async () => {
    await queue.close();
    await conn.quit();
  });

  app.post('/', async (req, reply) => {
    const body = BacktestRequestSchema.parse(req.body);
    const doc = await BacktestModel.create({
      userId: req.user!.userId,
      strategyId: body.strategyId,
      status: 'queued',
      range: body.range,
      timeframe: body.timeframe,
      initialCapital: body.initialCapital,
      slippageBps: body.slippageBps,
      commissionPerOrder: body.commissionPerOrder,
      progress: 0,
    });
    await queue.add('run', { backtestId: String(doc._id) });
    return reply.code(202).send({ id: String(doc._id), status: 'queued' });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await BacktestModel.findById(id);
    if (!doc) throw new NotFoundError('Backtest', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    return doc.toObject();
  });

  app.get('/', async (req) => {
    const q = ListSchema.parse(req.query);
    const filter: Record<string, unknown> = { userId: req.user!.userId };
    if (q.strategyId) filter.strategyId = q.strategyId;
    return BacktestModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .select('-results.equityCurve -results.trades') // keep list responses light
      .lean();
  });
};
