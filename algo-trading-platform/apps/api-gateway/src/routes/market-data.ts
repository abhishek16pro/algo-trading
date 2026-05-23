import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HistoricalCandleModel } from '@algo/db';
import { RedisKeys } from '@algo/redis-client';

const QuoteSchema = z.object({ tokens: z.string().min(1) });

const CandlesSchema = z.object({
  token: z.string(),
  tf: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '1d']),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const marketDataRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/quote', async (req) => {
    const q = QuoteSchema.parse(req.query);
    const tokens = q.tokens.split(',').map((t) => t.trim()).filter(Boolean);
    const out: Record<string, { ltp: number; ts: number }> = {};
    for (const t of tokens) {
      const data = await app.ctx.redis.hgetall(RedisKeys.tickLast(t));
      if (data && data.ltp) {
        out[t] = { ltp: Number(data.ltp), ts: Number(data.ts ?? 0) };
      }
    }
    return out;
  });

  app.get('/candles', async (req) => {
    const q = CandlesSchema.parse(req.query);
    const rows = await HistoricalCandleModel.find({
      instrumentToken: q.token,
      timeframe: q.tf,
      t: { $gte: q.from, $lte: q.to },
    })
      .sort({ t: 1 })
      .lean();
    return rows;
  });
};
