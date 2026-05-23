'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE ?? 'http://localhost:4000';

const SocketCtx = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const ref = useRef<Socket | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) return;
    const s = io(WS_BASE, { auth: { token }, transports: ['websocket'] });
    ref.current = s;
    setSocket(s);
    return () => {
      s.disconnect();
      ref.current = null;
      setSocket(null);
    };
  }, []);

  return <SocketCtx.Provider value={socket}>{children}</SocketCtx.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketCtx);
}

export function useTicks(token: string | null, onTick: (tick: { ltp: number; ltt: string }) => void): void {
  const socket = useSocket();
  useEffect(() => {
    if (!socket || !token) return;
    socket.emit('join:tick', token);
    const handler = (t: { instrumentToken: string; ltp: number; ltt: string }) => {
      if (t.instrumentToken === token) onTick(t);
    };
    socket.on('tick', handler);
    return () => {
      socket.emit('leave:tick', token);
      socket.off('tick', handler);
    };
  }, [socket, token, onTick]);
}
