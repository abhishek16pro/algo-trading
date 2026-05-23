import { randomUUID } from 'node:crypto';
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
  Tick,
  Timeframe,
} from '@algo/shared-types';
import { BaseAdapter } from '../BaseAdapter.js';
import type { IBrokerAdapter } from '../IBrokerAdapter.js';
import { generateMockInstruments } from './mock-instruments.js';

type MockOrder = NormalizedOrder & { _userQty: number };

/**
 * In-process broker simulator.
 *
 *   - Generates a deterministic-seed Geometric Brownian Motion price walk per token at 1 Hz.
 *   - Holds an in-memory order book and matches MARKET orders against LTP immediately;
 *     LIMIT and SL/SL-M against the price walk.
 *   - Emits `tick` and `order` events identical in shape to real adapters.
 *
 * Used in dev when DEFAULT_BROKER=mock and as the default in test environments.
 */
export class MockBrokerAdapter extends BaseAdapter implements IBrokerAdapter {
  readonly id = 'mock' as const;

  private prices = new Map<string, number>();
  private subs = new Set<string>();
  private tickTimer: NodeJS.Timeout | undefined;
  private orders = new Map<string, MockOrder>();
  private trades: NormalizedTrade[] = [];
  private positions = new Map<string, NormalizedPosition>();
  private funds: Funds = { available: 500_000, used: 0, total: 500_000 };
  private instruments: NormalizedInstrument[] = [];
  private connected = false;
  private fundsLock = false;

  // ------------------------------------------------------------------ Auth
  async login(_creds: BrokerCredentials): Promise<BrokerLoginResult> {
    return {
      accessToken: `mock-access-${randomUUID()}`,
      refreshToken: `mock-refresh-${randomUUID()}`,
      expiry: new Date(Date.now() + 24 * 3600_000),
    };
  }
  async refreshAccessToken(_rt: string) {
    return { accessToken: `mock-access-${randomUUID()}`, expiry: new Date(Date.now() + 24 * 3600_000) };
  }
  async isTokenValid(_creds: BrokerCredentials) {
    return true;
  }

  // ------------------------------------------------------------------ Instruments
  async fetchInstruments(): Promise<NormalizedInstrument[]> {
    if (this.instruments.length === 0) {
      this.instruments = generateMockInstruments();
      for (const ins of this.instruments)
        this.prices.set(ins.instrumentToken, this.seedPrice(ins, ins.instrumentToken));
    }
    return this.instruments;
  }

  // ------------------------------------------------------------------ Orders
  async placeOrder(req: NormalizedOrderRequest): Promise<{ brokerOrderId: string }> {
    const brokerOrderId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const ins = this.findInstrument(req.tradingsymbol, req.exchange);
    const token = ins?.instrumentToken ?? req.tradingsymbol;
    const ltp = this.prices.get(token) ?? req.price ?? 100;

    const order: MockOrder = {
      brokerOrderId,
      instrumentToken: token,
      tradingsymbol: req.tradingsymbol,
      exchange: req.exchange,
      side: req.side,
      quantity: req.quantity,
      _userQty: req.quantity,
      orderType: req.orderType,
      product: req.product,
      validity: req.validity ?? 'DAY',
      price: req.price ?? 0,
      triggerPrice: req.triggerPrice ?? 0,
      filledQty: 0,
      pendingQty: req.quantity,
      averagePrice: 0,
      status: 'OPEN',
      tag: req.tag,
      placedAt: new Date(),
      updatedAt: new Date(),
    };
    this.orders.set(brokerOrderId, order);

    if (req.orderType === 'MARKET') {
      this.fillOrder(order, ltp);
    }
    return { brokerOrderId };
  }

  async modifyOrder(brokerOrderId: string, patch: Partial<NormalizedOrderRequest>): Promise<void> {
    const o = this.orders.get(brokerOrderId);
    if (!o) throw new Error(`Order ${brokerOrderId} not found`);
    if (o.status === 'COMPLETE' || o.status === 'CANCELLED' || o.status === 'REJECTED') {
      throw new Error(`Order ${brokerOrderId} cannot be modified (status=${o.status})`);
    }
    if (patch.price !== undefined) o.price = patch.price;
    if (patch.triggerPrice !== undefined) o.triggerPrice = patch.triggerPrice;
    if (patch.quantity !== undefined) {
      o.quantity = patch.quantity;
      o.pendingQty = patch.quantity - o.filledQty;
    }
    o.updatedAt = new Date();
    this.emitter.emit('order', {
      brokerOrderId,
      status: o.status,
      filledQty: o.filledQty,
      pendingQty: o.pendingQty,
      averagePrice: o.averagePrice,
      timestamp: o.updatedAt,
    });
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const o = this.orders.get(brokerOrderId);
    if (!o) throw new Error(`Order ${brokerOrderId} not found`);
    if (o.status === 'COMPLETE') throw new Error('Order already complete');
    o.status = 'CANCELLED';
    o.updatedAt = new Date();
    this.emitter.emit('order', {
      brokerOrderId,
      status: 'CANCELLED' as const,
      filledQty: o.filledQty,
      pendingQty: 0,
      averagePrice: o.averagePrice,
      timestamp: o.updatedAt,
    });
  }

  async getOrder(brokerOrderId: string): Promise<NormalizedOrder> {
    const o = this.orders.get(brokerOrderId);
    if (!o) throw new Error(`Order ${brokerOrderId} not found`);
    return this.cloneOrder(o);
  }

  async getOrderBook(): Promise<NormalizedOrder[]> {
    return Array.from(this.orders.values()).map((o) => this.cloneOrder(o));
  }

  async getTradeBook(): Promise<NormalizedTrade[]> {
    return [...this.trades];
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    return Array.from(this.positions.values());
  }

  async getHoldings(): Promise<NormalizedHolding[]> {
    return [];
  }

  async getFunds(): Promise<Funds> {
    return { ...this.funds };
  }

  // ------------------------------------------------------------------ Market data
  async getQuote(tokens: string[]): Promise<Record<string, NormalizedQuote>> {
    const out: Record<string, NormalizedQuote> = {};
    for (const t of tokens) {
      const ltp = this.prices.get(t) ?? 0;
      out[t] = {
        instrumentToken: t,
        ltp,
        timestamp: new Date(),
      };
    }
    return out;
  }

  async getHistorical(token: string, from: Date, to: Date, tf: Timeframe): Promise<Candle[]> {
    const mins = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '1d': 375 }[tf];
    const out: Candle[] = [];
    let price = this.prices.get(token) ?? 1000;
    const start = Math.floor(from.getTime() / (mins * 60_000)) * mins * 60_000;
    const end = to.getTime();
    let rng = mulberry32(this.hashSeed(token));
    for (let t = start; t < end; t += mins * 60_000) {
      const o = price;
      const drift = (rng() - 0.5) * 0.002;
      const c = o * (1 + drift);
      const h = Math.max(o, c) * (1 + Math.abs(rng() - 0.5) * 0.0015);
      const l = Math.min(o, c) * (1 - Math.abs(rng() - 0.5) * 0.0015);
      const v = Math.floor(rng() * 100_000);
      out.push({ t: new Date(t), o, h, l, c, v });
      price = c;
    }
    return out;
  }

  // ------------------------------------------------------------------ WebSocket
  async connectWS(): Promise<void> {
    if (this.connected) return;
    // Lazily build the contract master so subscribe() can look up the instrument and seed
    // a realistic LTP (e.g. BANKNIFTY ~ 52000) instead of the 1000 default.
    if (this.instruments.length === 0) await this.fetchInstruments();
    this.connected = true;
    this.tickTimer = setInterval(() => this.emitTicks(), 1000);
    this.emitter.emit('connect');
  }

  async disconnectWS(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.emitter.emit('disconnect', 'manual');
  }

  async subscribe(tokens: string[], _mode: SubscriptionMode): Promise<void> {
    for (const t of tokens) {
      this.subs.add(t);
      if (!this.prices.has(t)) {
        const ins = this.instruments.find((i) => i.instrumentToken === t);
        this.prices.set(t, this.seedPrice(ins, t));
      }
    }
  }

  async unsubscribe(tokens: string[]): Promise<void> {
    for (const t of tokens) this.subs.delete(t);
  }

  // ------------------------------------------------------------------ Internals
  /** Emits one tick per subscribed token via geometric Brownian motion. */
  private emitTicks(): void {
    for (const token of this.subs) {
      const cur = this.prices.get(token) ?? 1000;
      // Tame volatility — these are simulated, not real-market scale.
      const dt = 1 / (252 * 6.25 * 3600); // 1-second step in trading-year units
      const mu = 0.0;
      const sigma = 0.12;
      const z = gaussian();
      const next = cur * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z);
      const ltp = Math.round(next * 20) / 20; // 0.05 tick
      this.prices.set(token, ltp);

      const tick: Tick = {
        instrumentToken: token,
        brokerToken: token,
        ltp,
        ltt: new Date(),
        volume: Math.floor(Math.random() * 1000),
        bid: ltp - 0.05,
        ask: ltp + 0.05,
        bidQty: 100,
        askQty: 100,
        receivedAt: new Date(),
        broker: 'mock',
      };
      this.emitter.emit('tick', tick);
      this.checkPendingOrders(token, ltp);
    }
  }

  private checkPendingOrders(token: string, ltp: number): void {
    for (const o of this.orders.values()) {
      if (o.instrumentToken !== token) continue;
      if (o.status !== 'OPEN') continue;
      const limitPrice = o.price ?? 0;
      if (o.orderType === 'LIMIT') {
        if ((o.side === 'BUY' && ltp <= limitPrice) || (o.side === 'SELL' && ltp >= limitPrice)) {
          this.fillOrder(o, ltp);
        }
      } else if (o.orderType === 'SL' || o.orderType === 'SL-M') {
        const triggered =
          (o.side === 'BUY' && ltp >= (o.triggerPrice ?? Infinity)) ||
          (o.side === 'SELL' && ltp <= (o.triggerPrice ?? -Infinity));
        if (triggered) {
          // SL converts to LIMIT, SL-M converts to MARKET
          if (o.orderType === 'SL-M') this.fillOrder(o, ltp);
          else if ((o.side === 'BUY' && ltp <= limitPrice) || (o.side === 'SELL' && ltp >= limitPrice)) {
            this.fillOrder(o, ltp);
          }
        }
      }
    }
  }

  private fillOrder(o: MockOrder, ltp: number): void {
    o.filledQty = o.quantity;
    o.pendingQty = 0;
    o.averagePrice = ltp;
    o.status = 'COMPLETE';
    o.filledAt = new Date();
    o.updatedAt = new Date();
    this.trades.push({
      tradeId: `TRD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      brokerOrderId: o.brokerOrderId,
      tradingsymbol: o.tradingsymbol,
      exchange: o.exchange,
      side: o.side,
      quantity: o.quantity,
      price: ltp,
      product: o.product,
      timestamp: new Date(),
    });
    this.updatePosition(o, ltp);
    this.emitter.emit('order', {
      brokerOrderId: o.brokerOrderId,
      status: 'COMPLETE' as const,
      filledQty: o.filledQty,
      pendingQty: 0,
      averagePrice: o.averagePrice,
      timestamp: o.updatedAt,
    });
  }

  private updatePosition(o: MockOrder, ltp: number): void {
    if (this.fundsLock) return;
    this.fundsLock = true;
    try {
      const key = `${o.exchange}:${o.tradingsymbol}:${o.product}`;
      const existing = this.positions.get(key);
      const signedQty = o.side === 'BUY' ? o.quantity : -o.quantity;
      const next: NormalizedPosition = existing
        ? mergePosition(existing, signedQty, ltp)
        : {
            tradingsymbol: o.tradingsymbol,
            exchange: o.exchange,
            instrumentToken: o.instrumentToken,
            product: o.product,
            netQty: signedQty,
            buyQty: o.side === 'BUY' ? o.quantity : 0,
            sellQty: o.side === 'SELL' ? o.quantity : 0,
            avgPrice: ltp,
            lastPrice: ltp,
            pnl: 0,
            realizedPnl: 0,
            unrealizedPnl: 0,
            mtm: 0,
            multiplier: 1,
          };
      this.positions.set(key, next);
      const notional = ltp * o.quantity;
      this.funds.used = Math.max(0, this.funds.used + (o.side === 'BUY' ? notional : -notional) * 0.2);
      this.funds.available = this.funds.total - this.funds.used;
    } finally {
      this.fundsLock = false;
    }
  }

  private findInstrument(symbol: string, ex: string): NormalizedInstrument | undefined {
    return this.instruments.find((i) => i.tradingsymbol === symbol && i.exchange === ex);
  }

  private cloneOrder(o: MockOrder): NormalizedOrder {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _userQty, ...rest } = o;
    return { ...rest };
  }

  private seedPrice(ins: NormalizedInstrument | undefined, token?: string): number {
    // First try the structured instrument.
    if (ins) {
      if (ins.underlying === 'NIFTY' && ins.instrumentType === 'IDX') return 24500;
      if (ins.underlying === 'BANKNIFTY' && ins.instrumentType === 'IDX') return 52000;
      if (ins.underlying === 'SENSEX' && ins.instrumentType === 'IDX') return 80000;
      if (ins.underlying === 'FINNIFTY' && ins.instrumentType === 'IDX') return 24000;
      if (ins.underlying === 'MIDCPNIFTY' && ins.instrumentType === 'IDX') return 13000;
      if (ins.instrumentType === 'CE' || ins.instrumentType === 'PE') {
        return Math.max(1, (ins.strike ?? 24000) * 0.01);
      }
      if (ins.instrumentType === 'FUT') return 24500;
    }
    // Token-format fallback: `IDX:NIFTY` / `OPT:BANKNIFTY:<date>:<strike>:<CE|PE>` / `FUT:NIFTY:<date>`
    if (token) {
      const parts = token.split(':');
      if (parts[0] === 'IDX') {
        const u = parts[1];
        if (u === 'NIFTY') return 24500;
        if (u === 'BANKNIFTY') return 52000;
        if (u === 'SENSEX') return 80000;
        if (u === 'FINNIFTY') return 24000;
        if (u === 'MIDCPNIFTY') return 13000;
      }
      if (parts[0] === 'OPT') {
        const strike = Number(parts[3] ?? 0);
        if (Number.isFinite(strike) && strike > 0) return Math.max(1, strike * 0.01);
      }
      if (parts[0] === 'FUT') {
        const u = parts[1];
        if (u === 'BANKNIFTY') return 52000;
        if (u === 'NIFTY') return 24500;
      }
    }
    return 1000;
  }

  private hashSeed(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}

function mergePosition(p: NormalizedPosition, signedQty: number, ltp: number): NormalizedPosition {
  const newNet = p.netQty + signedQty;
  let avg = p.avgPrice;
  let realized = p.realizedPnl;

  if (Math.sign(p.netQty) === Math.sign(signedQty) || p.netQty === 0) {
    avg = (p.avgPrice * Math.abs(p.netQty) + ltp * Math.abs(signedQty)) / Math.max(1, Math.abs(newNet));
  } else {
    const closingQty = Math.min(Math.abs(p.netQty), Math.abs(signedQty));
    const direction = p.netQty > 0 ? 1 : -1;
    realized += (ltp - p.avgPrice) * closingQty * direction;
    if (Math.abs(signedQty) > Math.abs(p.netQty)) avg = ltp;
  }

  const unreal = (ltp - avg) * newNet;
  return {
    ...p,
    netQty: newNet,
    buyQty: p.buyQty + Math.max(0, signedQty),
    sellQty: p.sellQty + Math.max(0, -signedQty),
    avgPrice: avg,
    lastPrice: ltp,
    realizedPnl: realized,
    unrealizedPnl: unreal,
    pnl: realized + unreal,
    mtm: realized + unreal,
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(): number {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
