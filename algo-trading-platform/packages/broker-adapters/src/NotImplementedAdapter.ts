import type {
  BrokerCredentials,
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
  SubscriptionMode,
  Timeframe,
  BrokerId,
} from '@algo/shared-types';
import { BaseAdapter } from './BaseAdapter.js';
import type { AdapterFactoryOptions, IBrokerAdapter } from './IBrokerAdapter.js';

/**
 * Skeleton for real-broker adapters. Subclasses override the methods they implement.
 *
 * Why a separate base instead of more code per broker: the live broker SDKs (kiteconnect,
 * smartapi-javascript, upstox-js-sdk, dhanhq, fyers-api-v3) all have different shapes; writing
 * each adapter is a focused task, but the contract surface is identical. By extending this
 * base, an unfinished adapter fails fast with a clear "not implemented" error rather than
 * silently returning empty data.
 */
export abstract class NotImplementedAdapter extends BaseAdapter implements IBrokerAdapter {
  abstract readonly id: BrokerId;
  protected readonly brokerAccountId: string;
  protected credentials: BrokerCredentials;
  protected appKey: string | undefined;

  constructor(opts: AdapterFactoryOptions) {
    super();
    this.brokerAccountId = opts.brokerAccountId;
    this.credentials = opts.credentials;
    this.appKey = opts.appKey;
  }

  protected unsupported(method: string): never {
    throw new Error(`[${this.id}] ${method} not implemented yet`);
  }

  async login(_creds: BrokerCredentials): Promise<BrokerLoginResult> {
    return this.unsupported('login');
  }
  async refreshAccessToken(_rt: string): Promise<{ accessToken: string; expiry: Date }> {
    return this.unsupported('refreshAccessToken');
  }
  async isTokenValid(_creds: BrokerCredentials): Promise<boolean> {
    return this.unsupported('isTokenValid');
  }
  async fetchInstruments(): Promise<NormalizedInstrument[]> {
    return this.unsupported('fetchInstruments');
  }
  async placeOrder(_req: NormalizedOrderRequest): Promise<{ brokerOrderId: string }> {
    return this.unsupported('placeOrder');
  }
  async modifyOrder(_id: string, _patch: Partial<NormalizedOrderRequest>): Promise<void> {
    return this.unsupported('modifyOrder');
  }
  async cancelOrder(_id: string): Promise<void> {
    return this.unsupported('cancelOrder');
  }
  async getOrder(_id: string): Promise<NormalizedOrder> {
    return this.unsupported('getOrder');
  }
  async getOrderBook(): Promise<NormalizedOrder[]> {
    return this.unsupported('getOrderBook');
  }
  async getTradeBook(): Promise<NormalizedTrade[]> {
    return this.unsupported('getTradeBook');
  }
  async getPositions(): Promise<NormalizedPosition[]> {
    return this.unsupported('getPositions');
  }
  async getHoldings(): Promise<NormalizedHolding[]> {
    return this.unsupported('getHoldings');
  }
  async getFunds(): Promise<Funds> {
    return this.unsupported('getFunds');
  }
  async getQuote(_tokens: string[]): Promise<Record<string, NormalizedQuote>> {
    return this.unsupported('getQuote');
  }
  async getHistorical(_t: string, _f: Date, _to: Date, _tf: Timeframe): Promise<Candle[]> {
    return this.unsupported('getHistorical');
  }
  async connectWS(): Promise<void> {
    return this.unsupported('connectWS');
  }
  async disconnectWS(): Promise<void> {
    return this.unsupported('disconnectWS');
  }
  async subscribe(_tokens: string[], _mode: SubscriptionMode): Promise<void> {
    return this.unsupported('subscribe');
  }
  async unsubscribe(_tokens: string[]): Promise<void> {
    return this.unsupported('unsubscribe');
  }
}
