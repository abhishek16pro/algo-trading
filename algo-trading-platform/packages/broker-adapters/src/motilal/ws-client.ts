import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { Tick } from '@algo/shared-types';

const PROD_WS = 'wss://openapi.motilaloswal.com/ws';
const UAT_WS = 'wss://uatopenapi.motilaloswal.com/ws';

export type MotilalWsOptions = {
  apiKey: string;
  authToken: string;
  clientCode: string;
  env?: 'prod' | 'uat';
};

/**
 * Motilal Oswal broadcast WebSocket client.
 *
 *   - On connect, sends the auth message { clientid, authtoken, apikey } (per docs §5).
 *   - Subscriptions are keyed by exchange + scripcode. We accept tokens in our internal format
 *     `EX:SCRIPCODE` (e.g. `NSE:11536`) which is what we put in `Instrument.brokerTokens.motilal`.
 *   - Incoming LTP tick (per docs): `{ "Exchange": "BSE", "Scrip Code": 532540, "Time": "...",
 *     "LTP_Rate": 3636.8, "LTP_Qty": 4 }`. We translate to our `Tick` shape.
 *   - Auto-pings every 25s. Caller is responsible for reconnect (we just emit 'disconnect').
 *
 * Caveat: The exact subscribe-message JSON is not in the public docs (Motilal ships a browser
 * `mofsl.js` SDK that calls `Mofsl.Register(exchange, segment, scripcode)`). The most widely-used
 * shape (and what the Tradetron/OpenAlgo integrations use) is included below. If your Motilal
 * setup uses a different on-the-wire format, override `subscribeMessage()` here.
 */
export class MotilalWs extends EventEmitter {
  private ws: WebSocket | undefined;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly authToken: string;
  private readonly clientCode: string;
  private pingTimer: NodeJS.Timeout | undefined;
  private subscribed = new Set<string>();
  private isAuthed = false;
  private pending: Array<() => void> = [];

  constructor(opts: MotilalWsOptions) {
    super();
    this.url = opts.env === 'uat' ? UAT_WS : PROD_WS;
    this.apiKey = opts.apiKey;
    this.authToken = opts.authToken;
    this.clientCode = opts.clientCode;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.once('open', () => {
        // Auth handshake
        ws.send(
          JSON.stringify({
            clientid: this.clientCode,
            authtoken: this.authToken,
            apikey: this.apiKey,
          }),
        );
        // No explicit ack documented; assume next 200ms or first valid message confirms auth.
        setTimeout(() => {
          this.isAuthed = true;
          // Flush pending subscribes
          for (const fn of this.pending.splice(0)) fn();
          this.emit('connect');
          this.startPing();
          resolve();
        }, 250);
      });

      ws.on('message', (raw) => this.onMessage(raw));

      ws.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      ws.on('close', (code, reason) => {
        this.stopPing();
        this.isAuthed = false;
        this.emit('disconnect', `code=${code} reason=${reason.toString()}`);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // already closed
      }
    }
    this.ws = undefined;
    this.isAuthed = false;
  }

  subscribe(tokens: string[]): void {
    if (!this.isAuthed) {
      this.pending.push(() => this.subscribe(tokens));
      return;
    }
    for (const t of tokens) {
      if (this.subscribed.has(t)) continue;
      this.subscribed.add(t);
      const msg = this.subscribeMessage(t);
      if (msg && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }
  }

  unsubscribe(tokens: string[]): void {
    for (const t of tokens) {
      if (!this.subscribed.has(t)) continue;
      this.subscribed.delete(t);
      const msg = this.unsubscribeMessage(t);
      if (msg && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }
  }

  /** Build a subscribe message for one of our internal tokens (e.g. "NSE:11536" or "IDX:NSE"). */
  protected subscribeMessage(internalToken: string): object | null {
    const parsed = parseInternalToken(internalToken);
    if (!parsed) return null;
    if (parsed.kind === 'index') {
      // Motilal: `Mofsl.IndexRegister("NSE")` — internal exchange-level subscription.
      return { action: 'IndexRegister', exchange: parsed.exchange };
    }
    return {
      action: 'Register',
      exchange: parsed.exchange,
      // "CASH" for equities, "FNO" for futures/options
      segment: parsed.segment,
      scripcode: parsed.scripCode,
    };
  }

  protected unsubscribeMessage(internalToken: string): object | null {
    const parsed = parseInternalToken(internalToken);
    if (!parsed) return null;
    if (parsed.kind === 'index') {
      return { action: 'IndexUnregister', exchange: parsed.exchange };
    }
    return {
      action: 'UnRegister',
      exchange: parsed.exchange,
      segment: parsed.segment,
      scripcode: parsed.scripCode,
    };
  }

  private onMessage(raw: WebSocket.RawData): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    // Common Motilal LTP message shape
    if ('LTP_Rate' in p) {
      const tick = normalizeTick(p);
      if (tick) this.emit('tick', tick);
      return;
    }
    // Order updates would arrive here too; bubble up for the adapter to handle.
    this.emit('raw', payload);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {
          // ignore
        }
      }
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}

type ParsedToken =
  | { kind: 'scrip'; exchange: string; segment: 'CASH' | 'FNO' | 'CDS' | 'COM'; scripCode: number }
  | { kind: 'index'; exchange: string };

function parseInternalToken(t: string): ParsedToken | null {
  // "IDX:NSE", "NSE:11536", "NFO:12345", "BFO:54321"
  const parts = t.split(':');
  if (parts.length < 2) return null;
  if (parts[0] === 'IDX') return { kind: 'index', exchange: parts[1]! };
  const ex = parts[0]!;
  const code = Number(parts[1]);
  if (!Number.isFinite(code)) return null;
  const segment = ex === 'NFO' || ex === 'BFO' ? 'FNO' : ex === 'CDS' ? 'CDS' : ex === 'MCX' ? 'COM' : 'CASH';
  return { kind: 'scrip', exchange: ex, segment, scripCode: code };
}

function normalizeTick(p: Record<string, unknown>): Tick | null {
  const exchange = String(p['Exchange'] ?? '');
  const scripCode = Number(p['Scrip Code'] ?? p['ScripCode'] ?? p['scripcode'] ?? 0);
  if (!exchange || !scripCode) return null;
  const ltp = Number(p['LTP_Rate'] ?? p['LTP'] ?? 0);
  const ltq = Number(p['LTP_Qty'] ?? 0);
  const timeStr = String(p['Time'] ?? '');
  const ltt = timeStr ? new Date(timeStr.replace(' ', 'T') + '+05:30') : new Date();
  const internalToken = `${exchange}:${scripCode}`;
  return {
    instrumentToken: internalToken,
    brokerToken: String(scripCode),
    ltp,
    ltt,
    volume: Number(p['Volume'] ?? 0) || 0,
    bid: Number(p['Bid_Rate'] ?? 0) || undefined,
    ask: Number(p['Offer_Rate'] ?? 0) || undefined,
    bidQty: Number(p['Bid_Qty'] ?? 0) || undefined,
    askQty: Number(p['Offer_Qty'] ?? 0) || undefined,
    oi: Number(p['OpenInterest'] ?? 0) || undefined,
    receivedAt: new Date(),
    broker: 'motilal',
    // Stash last-traded qty in a non-typed slot so the strategy engine can read it if it wants:
    ...(ltq ? { __ltq: ltq } : {}),
  } as Tick;
}
