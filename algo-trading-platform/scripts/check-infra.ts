/**
 * Quick smoke-test for infra connectivity. Run BEFORE seed/dev.
 *   pnpm tsx scripts/check-infra.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';

async function checkMongo(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  console.log('→ Mongo: connecting to', redact(uri));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const admin = mongoose.connection.db?.admin();
  const res = await admin?.ping();
  console.log('✓ Mongo ping:', res);
  const stats = await mongoose.connection.db?.stats();
  console.log('✓ Mongo db:', mongoose.connection.name, '— collections:', stats?.collections ?? 0);
  await mongoose.disconnect();
}

async function checkRedis(): Promise<void> {
  const uri = process.env.REDIS_URI;
  if (!uri) throw new Error('REDIS_URI not set');
  console.log('→ Redis: connecting to', redact(uri));
  const r = new Redis(uri, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true });
  try {
    await r.connect();
    const pong = await r.ping();
    console.log('✓ Redis ping:', pong);
  } finally {
    r.disconnect();
  }
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

async function main(): Promise<void> {
  const results: Record<string, string> = {};
  try {
    await checkMongo();
    results.mongo = 'OK';
  } catch (err) {
    results.mongo = `FAIL: ${(err as Error).message}`;
  }
  try {
    await checkRedis();
    results.redis = 'OK';
  } catch (err) {
    results.redis = `FAIL: ${(err as Error).message}`;
  }
  console.log('\n--- Summary ---');
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(8)} ${v}`);
  process.exit(results.mongo === 'OK' && results.redis === 'OK' ? 0 : 1);
}

main().catch((err) => {
  console.error('check-infra failed:', err);
  process.exit(1);
});
