import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrderModel } from '@algo/db';
import { NormalizedOrderRequestSchema } from '@algo/shared-types';
import { ForbiddenError, NotFoundError } from '@algo/utils';

const ListSchema = z.object({
  status: z.string().optional(),
  strategyId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const PlaceSchema = NormalizedOrderRequestSchema.extend({
  brokerAccountId: z.string(),
  mode: z.enum(['live', 'paper']).default('paper'),
  strategyId: z.string().optional(),
});

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = ListSchema.parse(req.query);
    const filter: Record<string, unknown> = { userId: req.user!.userId };
    if (q.status) filter.status = q.status;
    if (q.strategyId) filter.strategyId = q.strategyId;
    if (q.from || q.to) {
      const ts: Record<string, Date> = {};
      if (q.from) ts.$gte = q.from;
      if (q.to) ts.$lte = q.to;
      filter.placedAt = ts;
    }
    return OrderModel.find(filter).sort({ placedAt: -1 }).limit(q.limit).lean();
  });

  app.post('/', async (req, reply) => {
    const body = PlaceSchema.parse(req.body);
    await app.ctx.pubsub.publish('exec:place', {
      req: body,
      ctx: {
        userId: req.user!.userId,
        brokerAccountId: body.brokerAccountId,
        mode: body.mode,
        strategyId: body.strategyId,
      },
    });
    return reply.code(202).send({ ok: true, message: 'Order queued for placement' });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const order = await OrderModel.findById(id);
    if (!order) throw new NotFoundError('Order', id);
    if (String(order.userId) !== req.user!.userId) throw new ForbiddenError();
    await app.ctx.pubsub.publish('exec:cancel', {
      orderId: id,
      userId: req.user!.userId,
      brokerAccountId: String(order.brokerAccountId),
      mode: order.mode,
    });
    return { ok: true };
  });
};
