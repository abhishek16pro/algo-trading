import 'dotenv/config';
import { Redis } from 'ioredis';

async function main(): Promise<void> {
  const r = new Redis(process.env.REDIS_URI!, { maxRetriesPerRequest: null, enableReadyCheck: false });
  console.log('=== Redis key inventory ===');
  const patterns = ['tick:last:*', 'tick:ohlc:*', 'subs:global', 'sub:refcount:*', 'service:heartbeat:*', 'strategy:state:*'];
  for (const p of patterns) {
    const keys = await r.keys(p);
    console.log('\n' + p + ' -> ' + keys.length + ' key(s)');
    if (keys.length > 0 && keys.length <= 7) {
      for (const k of keys) {
        const t = await r.type(k);
        if (t === 'hash') console.log('  ' + k + ' (hash):', await r.hgetall(k));
        else if (t === 'set') console.log('  ' + k + ' (set, size=' + (await r.scard(k)) + '):', (await r.smembers(k)).slice(0, 8));
        else if (t === 'string') console.log('  ' + k + ' (string):', await r.get(k));
      }
    } else if (keys.length > 7) {
      console.log('  sample:', keys.slice(0, 3));
    }
  }
  r.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
