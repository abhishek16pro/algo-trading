import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PositionModel } from '@algo/db';
import { ForbiddenError, NotFoundError } from '@algo/utils';

const ListSchema = z.object({
  mode: z.enum(['live', 'paper']).optional(),
  strategyId: z.string().optional(),
});

export const positionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = ListSchema.parse(req.query);
    const filter: Record<string, unknown> = { userId: req.user!.userId };
    if (q.mode) filter.mode = q.mode;
    if (q.strategyId) filter.strategyId = q.strategyId;
    return PositionModel.find(filter).sort({ openedAt: -1 }).lean();
  });

  app.post('/:id/squareoff', async (req) => {
    const { id } = req.params as { id: string };
    const pos = await PositionModel.findById(id);
    if (!pos) throw new NotFoundError('Position', id);
    if (String(pos.userId) !== req.user!.userId) throw new ForbiddenError();
    if (pos.netQty === 0) return { ok: true, message: 'Already flat' };
    const side = pos.netQty! > 0 ? 'SELL' : 'BUY';
    await app.ctx.pubsub.publish('exec:place', {
      req: {
        tradingsymbol: pos.tradingsymbol,
        exchange: pos.exchange,
        side,
        quantity: Math.abs(pos.netQty!),
        orderType: 'MARKET',
        product: pos.product,
        validity: 'DAY',
        tag: 'squareoff',
      },
      ctx: {
        userId: req.user!.userId,
        brokerAccountId: String(pos.brokerAccountId),
        mode: pos.mode,
        strategyId: pos.strategyId ? String(pos.strategyId) : undefined,
      },
    });
    return { ok: true };
  });
};
