import mongoose from 'mongoose';
import type { Logger } from '@algo/utils';

let connected = false;

export async function connectMongo(uri: string, log?: Logger): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');

  mongoose.connection.on('connected', () => log?.info({ uri: redactUri(uri) }, 'mongo connected'));
  mongoose.connection.on('error', (err) => log?.error({ err }, 'mongo error'));
  mongoose.connection.on('disconnected', () => log?.warn('mongo disconnected'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 50,
    retryWrites: true,
  });
  connected = true;
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

function redactUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}
