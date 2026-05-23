import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { InstrumentModel } from '@algo/db';

const SearchSchema = z.object({
  q: z.string().min(1).max(50),
  exchange: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const OptionsChainSchema = z.object({
  underlying: z.string(),
  expiry: z.string().optional(),
});

export const instrumentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/search', async (req) => {
    const q = SearchSchema.parse(req.query);
    const filter: Record<string, unknown> = {
      tradingsymbol: { $regex: q.q.toUpperCase(), $options: 'i' },
    };
    if (q.exchange) filter.exchange = q.exchange;
    const rows = await InstrumentModel.find(filter).limit(q.limit).lean();
    return rows;
  });

  app.get('/options-chain', async (req) => {
    const q = OptionsChainSchema.parse(req.query);
    const filter: Record<string, unknown> = {
      underlying: q.underlying,
      instrumentType: { $in: ['CE', 'PE'] },
    };
    if (q.expiry) filter.expiry = new Date(q.expiry);
    const rows = await InstrumentModel.find(filter).sort({ strike: 1 }).lean();
    return rows;
  });
};
