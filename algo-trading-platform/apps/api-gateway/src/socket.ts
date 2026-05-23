import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { RedisPubSub } from '@algo/redis-client';
import type { AppConfig, Logger } from '@algo/utils';
import type { Tick } from '@algo/shared-types';

type Deps = { cfg: AppConfig; log: Logger; pubsub: RedisPubSub };

const TICK_THROTTLE_MS = 200; // max 5 msgs/sec per token per client

/**
 * Attaches the Socket.IO server to the api-gateway HTTP server.
 *
 *   - One Redis subscription per channel, fanned out to all relevant Socket.IO rooms.
 *   - Per-client throttle on tick events to avoid drowning the browser.
 */
export function attachSocket(http: HttpServer, deps: Deps): IOServer {
  const io = new IOServer(http, {
    cors: { origin: true, credentials: true },
    transports: ['websocket'],
  });

  // Auth handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('missing token'));
    try {
      const decoded = jwt.verify(token, deps.cfg.JWT_ACCESS_SECRET) as { sub: string; email: string };
      socket.data.userId = decoded.sub;
      socket.data.email = decoded.email;
      next();
    } catch {
      next(new Error('invalid token'));
    }
  });

  // Track per-client per-token throttle state
  const throttleState = new WeakMap<Socket, Map<string, number>>();

  io.on('connection', (socket) => {
    deps.log.debug({ userId: socket.data.userId, sid: socket.id }, 'socket connected');
    socket.join(`user:${socket.data.userId}`);
    throttleState.set(socket, new Map());

    socket.on('join:tick', (token: string) => socket.join(`tick:${token}`));
    socket.on('leave:tick', (token: string) => socket.leave(`tick:${token}`));
    socket.on('join:candle', (room: string) => socket.join(`candle:${room}`));
    socket.on('join:backtest', (id: string) => socket.join(`backtest:${id}`));

    socket.on('disconnect', () => {
      deps.log.debug({ userId: socket.data.userId }, 'socket disconnected');
    });
  });

  // ------- Fanout from Redis to rooms -------
  void deps.pubsub.psubscribe<Tick>('ticks.*', (chan, tick) => {
    const token = chan.slice('ticks.'.length);
    const room = io.to(`tick:${token}`);
    if ((room.local as unknown) === undefined) return;
    for (const [sid, s] of io.sockets.sockets) {
      if (!s.rooms.has(`tick:${token}`)) continue;
      const states = throttleState.get(s) ?? new Map();
      const last = states.get(token) ?? 0;
      const now = Date.now();
      if (now - last < TICK_THROTTLE_MS) continue;
      states.set(token, now);
      s.emit('tick', tick);
      void sid;
    }
  });

  void deps.pubsub.psubscribe<unknown>('orders.*', (chan, payload) => {
    const userId = chan.slice('orders.'.length);
    io.to(`user:${userId}`).emit('order:update', payload);
  });

  void deps.pubsub.psubscribe<unknown>('positions.*', (chan, payload) => {
    const userId = chan.slice('positions.'.length);
    io.to(`user:${userId}`).emit('position:update', payload);
  });

  void deps.pubsub.psubscribe<unknown>('candles.*', (chan, payload) => {
    io.to(`candle:${chan.slice('candles.'.length)}`).emit('candle', payload);
  });

  void deps.pubsub.psubscribe<unknown>('signals.*', (chan, payload) => {
    const signalId = chan.slice('signals.'.length);
    io.emit('signal', { signalId, payload });
  });

  void deps.pubsub.psubscribe<{ id: string; progress: number }>(
    'backtest:progress.*',
    (chan, payload) => {
      const id = chan.slice('backtest:progress.'.length);
      io.to(`backtest:${id}`).emit('backtest:progress', payload);
    },
  );

  return io;
}
