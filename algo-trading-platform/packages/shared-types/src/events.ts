/**
 * Redis pub/sub channel name helpers — typed, central, easy to grep.
 */
export const channels = {
  tick: (token: string) => `ticks.${token}`,
  signal: (signalId: string) => `signals.${signalId}`,
  orderUpdates: (userId: string) => `orders.${userId}`,
  positionUpdates: (userId: string) => `positions.${userId}`,
  brokerEvents: (brokerAccountId: string) => `broker.events.${brokerAccountId}`,
  candle: (token: string, tf: string) => `candles.${token}.${tf}`,
  strategyState: (strategyId: string) => `strategy.state.${strategyId}`,
  subscriptionRequest: 'subs.request',
} as const;

export type SubscriptionRequest =
  | { action: 'subscribe'; tokens: string[]; mode?: 'ltp' | 'quote' | 'full'; requesterId: string }
  | { action: 'unsubscribe'; tokens: string[]; requesterId: string };

export type BrokerEvent =
  | { kind: 'connected'; brokerAccountId: string }
  | { kind: 'disconnected'; brokerAccountId: string; reason?: string }
  | { kind: 'reconnected'; brokerAccountId: string }
  | { kind: 'token-expired'; brokerAccountId: string }
  | { kind: 'kill-switch'; brokerAccountId: string };

export type StrategyStateEvent = {
  strategyId: string;
  state: 'idle' | 'running' | 'paused' | 'error';
  lastError?: string;
  ts: Date;
};
