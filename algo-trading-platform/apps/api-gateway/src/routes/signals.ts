import type { FastifyPluginAsync } from 'fastify';
import { SignalModel } from '@algo/db';
import { SignalSchema } from '@algo/shared-types';
import { ForbiddenError, NotFoundError } from '@algo/utils';

export const signalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const docs = await SignalModel.find({
      $or: [{ userId: req.user!.userId }, { isPublic: true }],
      deletedAt: { $exists: false },
    }).lean();
    return docs;
  });

  app.post('/', async (req, reply) => {
    const body = SignalSchema.parse({ ...(req.body as object), userId: req.user!.userId });
    const doc = await SignalModel.create(body);
    return reply.code(201).send({ id: String(doc._id) });
  });

  app.put('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await SignalModel.findById(id);
    if (!doc) throw new NotFoundError('Signal', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    Object.assign(doc, SignalSchema.partial().parse(req.body));
    await doc.save();
    return doc.toObject();
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await SignalModel.findById(id);
    if (!doc) throw new NotFoundError('Signal', id);
    if (String(doc.userId) !== req.user!.userId) throw new ForbiddenError();
    doc.deletedAt = new Date();
    await doc.save();
    return { ok: true };
  });

  app.get('/templates', async () => {
    return [
      {
        name: 'EMA20 crosses above EMA50',
        indicator: 'EMA',
        params: { period: 20 },
        condition: 'crosses-above',
        compareTo: { type: 'indicator', indicator: 'EMA', params: { period: 50 } },
        timeframe: '5m',
      },
      {
        name: 'RSI(14) > 70 (overbought)',
        indicator: 'RSI',
        params: { period: 14 },
        condition: 'greater-than',
        compareTo: { type: 'value', value: 70 },
        timeframe: '5m',
      },
      {
        name: 'Supertrend flip up',
        indicator: 'SUPERTREND',
        params: { period: 10, multiplier: 3 },
        condition: 'greater-than',
        compareTo: { type: 'price', source: 'close' },
        timeframe: '5m',
      },
    ];
  });
};
