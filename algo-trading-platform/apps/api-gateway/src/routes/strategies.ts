import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { StrategyModel } from '@algo/db';
import { StrategySchema, channels } from '@algo/shared-types';
import { ForbiddenError, NotFoundError } from '@algo/utils';

const DeploySchema = z.object({ mode: z.enum(['live', 'paper']) });

export const strategyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const docs = await StrategyModel.find({ userId: req.user!.userId, deletedAt: { $exists: false } })
      .sort({ updatedAt: -1 })
      .lean();
    return docs;
  });

  app.post('/', async (req, reply) => {
    const body = StrategySchema.parse({ ...(req.body as object), userId: req.user!.userId });
    const doc = await StrategyModel.create(body);
    return reply.code(201).send({ id: String(doc._id) });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    return doc.toObject();
  });

  app.put('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    const body = StrategySchema.partial().parse(req.body);
    Object.assign(doc, body);
    await doc.save();
    return doc.toObject();
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    doc.deletedAt = new Date();
    doc.state = 'idle';
    await doc.save();
    return { ok: true };
  });

  app.post('/:id/deploy', async (req) => {
    const { id } = req.params as { id: string };
    const { mode } = DeploySchema.parse(req.body);
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    doc.mode = mode;
    doc.state = 'running';
    doc.lastRunAt = new Date();
    await doc.save();
    await app.ctx.pubsub.publish(channels.strategyState(id), {
      strategyId: id,
      state: 'running',
      ts: new Date(),
    });
    return { ok: true, state: doc.state };
  });

  app.post('/:id/pause', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    doc.state = 'paused';
    await doc.save();
    await app.ctx.pubsub.publish(channels.strategyState(id), {
      strategyId: id,
      state: 'paused',
      ts: new Date(),
    });
    return { ok: true };
  });

  app.post('/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    doc.mode = 'stopped';
    doc.state = 'idle';
    await doc.save();
    await app.ctx.pubsub.publish(channels.strategyState(id), {
      strategyId: id,
      state: 'idle',
      ts: new Date(),
    });
    return { ok: true };
  });

  app.post('/:id/squareoff', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await StrategyModel.findById(id);
    if (!doc) throw new NotFoundError('Strategy', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    await app.ctx.pubsub.publish(channels.strategyState(id), {
      strategyId: id,
      state: 'paused',
      ts: new Date(),
      lastError: 'squareoff requested',
    });
    return { ok: true };
  });
};
