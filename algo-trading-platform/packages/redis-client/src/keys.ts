/**
 * Centralized Redis key builders. NEVER hand-write redis keys outside this file.
 */
export const RedisKeys = {
  tickLast: (token: string) => `tick:last:${token}`,
  tickOhlc: (token: string, tf: string) => `tick:ohlc:${token}:${tf}`,
  subsBrokerUser: (broker: string, userId: string) => `subs:${broker}:${userId}`,
  subsGlobal: () => `subs:global`,
  subRefcount: (token: string) => `sub:refcount:${token}`,
  strategyState: (strategyId: string) => `strategy:state:${strategyId}`,
  idempotency: (key: string) => `idempotency:${key}`,
  rateOrder: (userId: string) => `rate:order:${userId}`,
  rateGeneric: (bucket: string, id: string) => `rate:${bucket}:${id}`,
  lockOrder: (userId: string, symbol: string) => `lock:order:${userId}:${symbol}`,
  lockMarketData: (brokerAccountId: string) => `lock:md:${brokerAccountId}`,
  session: (jti: string) => `session:${jti}`,
  refreshTokenWhitelist: (userId: string, jti: string) => `refresh:${userId}:${jti}`,
  paperLimits: (token: string) => `paper:limits:${token}`,
  paperStops: (token: string) => `paper:stops:${token}`,
  backtestProgress: (id: string) => `backtest:progress:${id}`,
} as const;
