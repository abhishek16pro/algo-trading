import type {
  BrokerCredentials,
  BrokerId,
  BrokerLoginResult,
  Candle,
  Funds,
  NormalizedHolding,
  NormalizedInstrument,
  NormalizedOrder,
  NormalizedOrderRequest,
  NormalizedPosition,
  NormalizedQuote,
  NormalizedTrade,
  OrderStatusEvent,
  SubscriptionMode,
  Tick,
  Timeframe,
} from '@algo/shared-types';

export type BrokerEventKind = 'tick' | 'order' | 'connect' | 'disconnect' | 'error';

export type BrokerEventHandlers = {
  tick?: (tick: Tick) => void;
  order?: (event: OrderStatusEvent) => void;
  connect?: () => void;
  disconnect?: (reason?: string) => void;
  error?: (err: unknown) => void;
};

/**
 * Single abstraction for every broker. Implementations MUST normalize every payload before
 * returning — the rest of the system never imports broker-specific types.
 */
export interface IBrokerAdapter {
  readonly id: BrokerId;

  // Auth
  login(creds: BrokerCredentials): Promise<BrokerLoginResult>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: Date }>;
  isTokenValid(creds: BrokerCredentials): Promise<boolean>;

  // Contract master
  fetchInstruments(): Promise<NormalizedInstrument[]>;

  // Orders
  placeOrder(req: NormalizedOrderRequest): Promise<{ brokerOrderId: string }>;
  modifyOrder(
    brokerOrderId: string,
    patch: Partial<NormalizedOrderRequest>,
  ): Promise<void>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getOrder(brokerOrderId: string): Promise<NormalizedOrder>;
  getOrderBook(): Promise<NormalizedOrder[]>;
  getTradeBook(): Promise<NormalizedTrade[]>;
  getPositions(): Promise<NormalizedPosition[]>;
  getHoldings(): Promise<NormalizedHolding[]>;
  getFunds(): Promise<Funds>;

  // Market data
  getQuote(tokens: string[]): Promise<Record<string, NormalizedQuote>>;
  getHistorical(token: string, from: Date, to: Date, tf: Timeframe): Promise<Candle[]>;

  // WebSocket
  connectWS(): Promise<void>;
  disconnectWS(): Promise<void>;
  subscribe(tokens: string[], mode: SubscriptionMode): Promise<void>;
  unsubscribe(tokens: string[]): Promise<void>;

  on<K extends keyof BrokerEventHandlers>(event: K, cb: NonNullable<BrokerEventHandlers[K]>): void;
}

export type AdapterContext = {
  brokerAccountId: string;
  credentials: BrokerCredentials;
};

export type AdapterFactoryOptions = {
  brokerAccountId: string;
  credentials: BrokerCredentials;
  appKey?: string;
};
