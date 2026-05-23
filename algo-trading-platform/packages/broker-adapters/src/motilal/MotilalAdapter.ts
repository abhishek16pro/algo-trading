import type {
  BrokerCredentials,
  BrokerLoginResult,
  BrokerProfile,
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
import { BaseAdapter } from '../BaseAdapter.js';
import type { AdapterFactoryOptions, IBrokerAdapter } from '../IBrokerAdapter.js';
import { MotilalHttp, type MotilalEnv } from './http.js';
import { MotilalWs } from './ws-client.js';

const SESSION_TTL_HOURS = 8; // Motilal sessions are valid for one trading day; refresh on next morning.

/**
 * Motilal Oswal OpenAPI adapter.
 *
 * Credentials required (collected on the /brokers connect form):
 *   - apiKey         — the "API Key" from the Motilal API dashboard
 *   - apiSecret      — the "API Secret" from the Motilal API dashboard
 *   - clientCode     — your Motilal client/userid (e.g. "AA017")
 *   - password       — your Motilal trading password
 *   - twoFA          — either your PAN in CAPS or DOB as "DD/MM/YYYY"
 *   - totpSecret     — (optional) 6-digit TOTP code from your authenticator app; if blank we
 *                       skip it and Motilal will use 2FA fallback
 *   - vendorInfo     — (optional) the "vendor info" string assigned to your app; usually empty
 *
 * After authenticate(), we cache the access_token in-memory. The execution-engine keeps the
 * adapter alive for the life of the process; the access token is rotated each morning by calling
 * authenticate() again (see auto-refresh hook in AdapterRegistry).
 */
export class MotilalAdapter extends BaseAdapter implements IBrokerAdapter {
  readonly id = 'motilal' as const;

  private readonly brokerAccountId: string;
  private credentials: BrokerCredentials;
  private readonly http: MotilalHttp;
  private ws: MotilalWs | undefined;
  private wsConnected = false;
  private readonly env: MotilalEnv;
  private contractCache: NormalizedInstrument[] | undefined;
  private contractByToken = new Map<string, NormalizedInstrument>();

  constructor(opts: AdapterFactoryOptions) {
    super();
    this.brokerAccountId = opts.brokerAccountId;
    this.credentials = opts.credentials;
    this.env = (process.env.MOTILAL_ENV as MotilalEnv) ?? 'prod';
    if (!this.credentials.apiKey || !this.credentials.apiSecret) {
      throw new Error('MotilalAdapter: apiKey + apiSecret required');
    }
    this.http = new MotilalHttp({
      apiKey: this.credentials.apiKey,
      apiSecretKey: this.credentials.apiSecret,
      vendorInfo: this.credentials.vendorInfo,
      env: this.env,
    });
    if (this.credentials.accessToken && this.credentials.refreshToken) {
      // refreshToken is reused here to mean the Motilal "AuthToken" we obtained earlier.
      this.http.loadSession({
        authToken: this.credentials.refreshToken,
        accessToken: this.credentials.accessToken,
      });
    }
  }

  // ----------------------------------------------------------- Auth
  async login(creds: BrokerCredentials): Promise<BrokerLoginResult> {
    this.credentials = { ...this.credentials, ...creds };
    const { authToken, accessToken } = await this.http.authenticate(this.credentials);
    return {
      accessToken,
      refreshToken: authToken, // we re-use refreshToken slot for the longer-lived AuthToken
      expiry: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000),
    };
  }

  async refreshAccessToken(_refreshToken: string): Promise<{ accessToken: string; expiry: Date }> {
    // Motilal access tokens are issued by re-running the full login flow.
    const { authToken: _authToken, accessToken } = await this.http.authenticate(this.credentials);
    return { accessToken, expiry: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000) };
  }

  async isTokenValid(_creds: BrokerCredentials): Promise<boolean> {
    if (!this.http.hasSession()) return false;
    try {
      await this.getProfile();
      return true;
    } catch {
      return false;
    }
  }

  async getProfile(): Promise<BrokerProfile> {
    if (!this.http.hasSession()) {
      await this.http.authenticate(this.credentials);
    }
    const resp = (await this.http.post<{ data?: Record<string, unknown> }>(
      '/rest/login/v5/getprofile',
      {},
    )) as { data?: Record<string, unknown> };
    const d = (resp.data ?? resp) as Record<string, unknown>;
    return {
      clientCode: String(d['clientcode'] ?? this.credentials.clientCode ?? ''),
      name: typeof d['name'] === 'string' ? d['name'] : undefined,
      email: typeof d['emailid'] === 'string' ? d['emailid'] : undefined,
      exchanges: Array.isArray(d['exchanges']) ? (d['exchanges'] as string[]) : undefined,
      products: Array.isArray(d['products']) ? (d['products'] as string[]) : undefined,
      segments: Array.isArray(d['segments']) ? (d['segments'] as string[]) : undefined,
      userType: typeof d['usertype'] === 'string' ? d['usertype'] : undefined,
      broker: 'motilal',
    };
  }

  // ----------------------------------------------------------- Instruments
  async fetchInstruments(): Promise<NormalizedInstrument[]> {
    if (this.contractCache) return this.contractCache;
    if (!this.http.hasSession()) await this.http.authenticate(this.credentials);
    const all: NormalizedInstrument[] = [];
    for (const exchange of ['NSE', 'NSEFO', 'BSE', 'BSEFO'] as const) {
      try {
        const csv = await this.http.getText('/getscripmastercsv', { name: exchange });
        const parsed = parseScripMasterCsv(csv, exchange);
        all.push(...parsed);
      } catch {
        // Best-effort — some users don't have all exchanges enabled.
      }
    }
    this.contractCache = all;
    for (const ins of all) this.contractByToken.set(ins.instrumentToken, ins);
    return all;
  }

  // ----------------------------------------------------------- Funds
  async getFunds(): Promise<Funds> {
    const resp = (await this.http.post<{ data?: Record<string, unknown> }>(
      '/rest/report/v3/getreportmarginsummary',
      {},
    )) as { data?: Record<string, unknown> };
    const d = (resp.data ?? resp) as Record<string, unknown>;
    const available = Number(d['availabalemargin'] ?? d['availablemargin'] ?? d['Available'] ?? 0);
    const used = Number(d['marginusedupfront'] ?? d['marginused'] ?? d['Used'] ?? 0);
    return {
      available,
      used,
      total: available + used,
    };
  }

  // ----------------------------------------------------------- Orders
  async placeOrder(req: NormalizedOrderRequest): Promise<{ brokerOrderId: string }> {
    const symbolToken = await this.resolveSymbolToken(req.tradingsymbol, req.exchange);
    const body = {
      clientcode: this.credentials.clientCode ?? '',
      exchange: mapExchangeOut(req.exchange),
      symboltoken: symbolToken,
      buyorsell: req.side,
      ordertype: mapOrderTypeOut(req.orderType),
      producttype: mapProductOut(req.product),
      orderduration: req.validity ?? 'DAY',
      price: req.price ?? 0,
      triggerprice: req.triggerPrice ?? 0,
      quantityinlot: req.quantity, // Motilal expects quantity-in-lots
      disclosedquantity: req.disclosedQty ?? 0,
      amoorder: 'N',
      tag: req.tag ?? '',
    };
    const resp = (await this.http.post<{ uniqueorderid?: string }>(
      '/rest/trans/v2/placeorder',
      body,
    )) as { uniqueorderid?: string };
    if (!resp.uniqueorderid) throw new Error('Motilal placeOrder: no uniqueorderid in response');
    return { brokerOrderId: resp.uniqueorderid };
  }

  async modifyOrder(brokerOrderId: string, patch: Partial<NormalizedOrderRequest>): Promise<void> {
    await this.http.post('/rest/trans/v5/modifyorder', {
      uniqueorderid: brokerOrderId,
      newordertype: patch.orderType ? mapOrderTypeOut(patch.orderType) : undefined,
      neworderduration: patch.validity,
      newprice: patch.price,
      newquantityinlot: patch.quantity,
      newtriggerprice: patch.triggerPrice,
    });
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.http.post('/rest/trans/v2/cancelorder', { uniqueorderid: brokerOrderId });
  }

  async getOrder(brokerOrderId: string): Promise<NormalizedOrder> {
    const all = await this.getOrderBook();
    const found = all.find((o) => o.brokerOrderId === brokerOrderId);
    if (!found) throw new Error(`Motilal: order ${brokerOrderId} not found in book`);
    return found;
  }

  async getOrderBook(): Promise<NormalizedOrder[]> {
    const resp = (await this.http.post<{ data?: unknown[] }>(
      '/rest/book/v5/getorderbook',
      {},
    )) as { data?: unknown[] };
    const rows = (resp.data ?? []) as Record<string, unknown>[];
    return rows.map((r) => mapOrderIn(r, this.credentials.clientCode ?? ''));
  }

  async getTradeBook(): Promise<NormalizedTrade[]> {
    const resp = (await this.http.post<{ data?: unknown[] }>(
      '/rest/book/v4/gettradebook',
      {},
    )) as { data?: unknown[] };
    const rows = (resp.data ?? []) as Record<string, unknown>[];
    return rows.map((r) => mapTradeIn(r));
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    const resp = (await this.http.post<{ data?: unknown[] }>(
      '/rest/book/v4/getposition',
      {},
    )) as { data?: unknown[] };
    const rows = (resp.data ?? []) as Record<string, unknown>[];
    return rows.map((r) => mapPositionIn(r));
  }

  async getHoldings(): Promise<NormalizedHolding[]> {
    // Motilal exposes holdings via the DP API; depending on account type this may not be available.
    // For now we return empty; users wanting holdings can plug in their DP feed.
    return [];
  }

  // ----------------------------------------------------------- Market data
  async getQuote(tokens: string[]): Promise<Record<string, NormalizedQuote>> {
    const out: Record<string, NormalizedQuote> = {};
    for (const t of tokens) {
      const parsed = t.split(':');
      if (parsed.length < 2) continue;
      const [exchange, scrip] = parsed;
      try {
        const resp = (await this.http.post<{ data?: Record<string, unknown> }>(
          '/rest/report/v3/getltpdata',
          { exchange, scripcode: Number(scrip) },
        )) as { data?: Record<string, unknown> };
        const d = (resp.data ?? resp) as Record<string, unknown>;
        out[t] = {
          instrumentToken: t,
          ltp: Number(d['ltp'] ?? d['LTP'] ?? 0),
          open: Number(d['open'] ?? 0) || undefined,
          high: Number(d['high'] ?? 0) || undefined,
          low: Number(d['low'] ?? 0) || undefined,
          close: Number(d['close'] ?? 0) || undefined,
          volume: Number(d['volume'] ?? 0) || undefined,
          oi: Number(d['oi'] ?? 0) || undefined,
          bid: Number(d['bid'] ?? 0) || undefined,
          ask: Number(d['ask'] ?? 0) || undefined,
          timestamp: new Date(),
        };
      } catch {
        // skip missing quotes
      }
    }
    return out;
  }

  async getHistorical(_token: string, _from: Date, _to: Date, _tf: Timeframe): Promise<Candle[]> {
    // Motilal exposes historical via a separate data API not in the trading scope.
    // Until the docs URL stabilizes we return empty rather than fake data.
    return [];
  }

  // ----------------------------------------------------------- WebSocket
  async connectWS(): Promise<void> {
    if (this.wsConnected) return;
    if (!this.http.hasSession()) await this.http.authenticate(this.credentials);
    const tokens = this.http.getTokens();
    if (!tokens) throw new Error('Motilal: cannot connect WS without tokens');
    this.ws = new MotilalWs({
      apiKey: this.credentials.apiKey!,
      authToken: tokens.authToken,
      clientCode: this.credentials.clientCode ?? '',
      env: this.env,
    });
    this.ws.on('tick', (t: Tick) => this.emitter.emit('tick', t));
    this.ws.on('disconnect', (r: unknown) => {
      this.wsConnected = false;
      this.emitter.emit('disconnect', String(r ?? ''));
    });
    this.ws.on('error', (e: unknown) => this.emitter.emit('error', e));
    await this.ws.connect();
    this.wsConnected = true;
    this.emitter.emit('connect');
  }

  async disconnectWS(): Promise<void> {
    if (this.ws) await this.ws.disconnect();
    this.ws = undefined;
    this.wsConnected = false;
  }

  async subscribe(tokens: string[], _mode: SubscriptionMode): Promise<void> {
    if (!this.ws) await this.connectWS();
    this.ws!.subscribe(tokens);
  }

  async unsubscribe(tokens: string[]): Promise<void> {
    this.ws?.unsubscribe(tokens);
  }

  // ----------------------------------------------------------- Helpers
  private async resolveSymbolToken(
    tradingsymbol: string,
    exchange: string,
  ): Promise<number> {
    if (this.contractCache === undefined) await this.fetchInstruments();
    const match = this.contractCache?.find(
      (i) => i.tradingsymbol === tradingsymbol && i.exchange === exchange,
    );
    if (!match) throw new Error(`Motilal: instrument ${tradingsymbol}@${exchange} not in contract master`);
    const code = Number(match.brokerTokens['motilal'] ?? match.instrumentToken.split(':')[1]);
    if (!Number.isFinite(code)) throw new Error(`Motilal: bad symboltoken for ${tradingsymbol}`);
    return code;
  }
}

// ============================================================ Mappers ====================
function mapExchangeOut(ex: string): string {
  if (ex === 'NFO') return 'NSEFO';
  if (ex === 'BFO') return 'BSEFO';
  return ex;
}

function mapOrderTypeOut(t: NormalizedOrderRequest['orderType']): string {
  switch (t) {
    case 'MARKET':
      return 'MARKET';
    case 'LIMIT':
      return 'LIMIT';
    case 'SL':
    case 'SL-M':
      return 'STOPLOSS';
  }
}

function mapProductOut(p: NormalizedOrderRequest['product']): string {
  switch (p) {
    case 'MIS':
      return 'VALUEPLUS'; // intraday product in Motilal
    case 'CNC':
      return 'DELIVERY';
    case 'NRML':
      return 'NORMAL';
  }
}

function mapOrderIn(r: Record<string, unknown>, clientCode: string): NormalizedOrder {
  const status = String(r['orderstatus'] ?? r['status'] ?? 'PENDING').toUpperCase();
  return {
    brokerOrderId: String(r['uniqueorderid'] ?? r['orderid'] ?? ''),
    instrumentToken: `${r['exchange']}:${r['symboltoken']}`,
    tradingsymbol: String(r['symbol'] ?? r['scripshortname'] ?? ''),
    exchange: (String(r['exchange'] ?? 'NSE') as NormalizedOrder['exchange']),
    side: (String(r['buyorsell'] ?? 'BUY').toUpperCase() as 'BUY' | 'SELL'),
    quantity: Number(r['orderqty'] ?? r['quantity'] ?? 0),
    filledQty: Number(r['tradedqty'] ?? r['filledqty'] ?? 0),
    pendingQty: Number(r['pendingqty'] ?? 0),
    orderType: (mapOrderTypeIn(String(r['ordertype'] ?? 'LIMIT')) as NormalizedOrder['orderType']),
    product: (mapProductIn(String(r['producttype'] ?? 'NORMAL')) as NormalizedOrder['product']),
    validity: (String(r['orderduration'] ?? 'DAY') as NormalizedOrder['validity']),
    price: Number(r['orderprice'] ?? r['price'] ?? 0),
    triggerPrice: Number(r['triggerprice'] ?? 0) || undefined,
    averagePrice: Number(r['averageprice'] ?? r['avgprice'] ?? 0),
    status: mapStatusIn(status),
    statusMessage: typeof r['error_reason'] === 'string' ? (r['error_reason'] as string) : undefined,
    placedAt: typeof r['orderdatetime'] === 'string' ? new Date(r['orderdatetime'] as string) : new Date(),
    updatedAt: new Date(),
    tag: typeof r['tag'] === 'string' ? (r['tag'] as string) : undefined,
  };
}

function mapOrderTypeIn(t: string): NormalizedOrder['orderType'] {
  if (t.toUpperCase() === 'MARKET') return 'MARKET';
  if (t.toUpperCase() === 'STOPLOSS') return 'SL-M';
  return 'LIMIT';
}

function mapProductIn(p: string): NormalizedOrder['product'] {
  const u = p.toUpperCase();
  if (u === 'VALUEPLUS' || u === 'MIS') return 'MIS';
  if (u === 'DELIVERY' || u === 'CNC') return 'CNC';
  return 'NRML';
}

function mapStatusIn(s: string): NormalizedOrder['status'] {
  const u = s.toUpperCase();
  if (u.includes('COMPLETE') || u === 'TRADED' || u === 'EXECUTED') return 'COMPLETE';
  if (u.includes('REJECT')) return 'REJECTED';
  if (u.includes('CANCEL')) return 'CANCELLED';
  if (u.includes('PARTIAL')) return 'PARTIAL';
  if (u === 'OPEN' || u === 'PENDING' || u === 'CONFIRMED') return 'OPEN';
  return 'PENDING';
}

function mapTradeIn(r: Record<string, unknown>): NormalizedTrade {
  return {
    tradeId: String(r['tradeid'] ?? r['tradenumber'] ?? ''),
    brokerOrderId: String(r['uniqueorderid'] ?? r['orderid'] ?? ''),
    tradingsymbol: String(r['symbol'] ?? ''),
    exchange: String(r['exchange'] ?? 'NSE') as NormalizedTrade['exchange'],
    side: String(r['buyorsell'] ?? 'BUY').toUpperCase() as 'BUY' | 'SELL',
    quantity: Number(r['tradedqty'] ?? 0),
    price: Number(r['tradeprice'] ?? r['price'] ?? 0),
    product: mapProductIn(String(r['producttype'] ?? '')) as NormalizedTrade['product'],
    timestamp: typeof r['tradetime'] === 'string' ? new Date(r['tradetime'] as string) : new Date(),
  };
}

function mapPositionIn(r: Record<string, unknown>): NormalizedPosition {
  const buyQty = Number(r['buyquantity'] ?? 0);
  const sellQty = Number(r['sellquantity'] ?? 0);
  const netQty = buyQty - sellQty;
  const buyAmt = Number(r['buyamount'] ?? 0);
  const sellAmt = Number(r['sellamount'] ?? 0);
  const ltp = Number(r['LTP'] ?? r['ltp'] ?? 0);
  const avg = netQty !== 0 ? (buyAmt - sellAmt) / netQty : 0;
  return {
    tradingsymbol: String(r['symbol'] ?? ''),
    exchange: String(r['exchange'] ?? 'NSE') as NormalizedPosition['exchange'],
    instrumentToken: `${r['exchange']}:${r['symboltoken']}`,
    product: mapProductIn(String(r['producttype'] ?? '')) as NormalizedPosition['product'],
    netQty,
    buyQty,
    sellQty,
    avgPrice: Math.abs(avg),
    lastPrice: ltp,
    pnl: Number(r['marktomarket'] ?? 0),
    realizedPnl: Number(r['bookedprofitloss'] ?? 0),
    unrealizedPnl: Number(r['marktomarket'] ?? 0),
    mtm: Number(r['marktomarket'] ?? 0),
    multiplier: 1,
  };
}

function parseScripMasterCsv(csv: string, exchange: string): NormalizedInstrument[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const out: NormalizedInstrument[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    const symboltoken = cols[idx('scripcode')] ?? cols[idx('symboltoken')] ?? '';
    if (!symboltoken) continue;
    const tradingsymbol = (cols[idx('scripshortname')] ?? cols[idx('scripname')] ?? '').trim();
    const instrumentname = (cols[idx('instrumentname')] ?? '').trim().toUpperCase();
    const expirydate = cols[idx('expirydate')] ?? '';
    const strike = Number(cols[idx('strikeprice')] ?? '0');
    const optiontype = (cols[idx('optiontype')] ?? '').trim().toUpperCase();
    const lotsize = Number(cols[idx('marketlot')] ?? '1');

    let instrumentType: NormalizedInstrument['instrumentType'] = 'EQ';
    let segment: NormalizedInstrument['segment'] = 'EQ';
    if (instrumentname.includes('FUT')) {
      instrumentType = 'FUT';
      segment = 'FUT';
    } else if (optiontype === 'CE') {
      instrumentType = 'CE';
      segment = 'OPT';
    } else if (optiontype === 'PE') {
      instrumentType = 'PE';
      segment = 'OPT';
    } else if (instrumentname.includes('IDX')) {
      instrumentType = 'IDX';
      segment = 'IDX';
    }
    out.push({
      tradingsymbol,
      exchange: mapExchangeIn(exchange) as NormalizedInstrument['exchange'],
      instrumentToken: `${mapExchangeIn(exchange)}:${symboltoken}`,
      brokerTokens: { motilal: symboltoken },
      segment,
      instrumentType,
      name: tradingsymbol,
      expiry: expirydate ? new Date(expirydate) : undefined,
      strike: Number.isFinite(strike) && strike > 0 ? strike : undefined,
      lotSize: Number.isFinite(lotsize) && lotsize > 0 ? lotsize : 1,
      tickSize: 0.05,
      underlying: inferUnderlying(tradingsymbol),
    });
  }
  return out;
}

function mapExchangeIn(ex: string): string {
  if (ex === 'NSEFO') return 'NFO';
  if (ex === 'BSEFO') return 'BFO';
  return ex;
}

function inferUnderlying(symbol: string): NormalizedInstrument['underlying'] | undefined {
  const known: NormalizedInstrument['underlying'][] = [
    'NIFTY',
    'BANKNIFTY',
    'SENSEX',
    'FINNIFTY',
    'MIDCPNIFTY',
    'BANKEX',
  ];
  for (const u of known) {
    if (u && symbol.toUpperCase().startsWith(u)) return u;
  }
  return undefined;
}

// Reference unused so TS doesn't strip type imports.
export type { OrderStatusEvent };
