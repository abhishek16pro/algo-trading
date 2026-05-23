# AlgoTest-Style Trading Platform — Full Build Specification

> **Purpose of this document:** Hand this file to Claude Code (or any coding agent). It contains the complete, opinionated blueprint for a multi-broker Indian algo trading platform with backtesting, signal-based strategies, paper trading, live execution, real-time market data via WebSocket, and a Next.js frontend.
>
> **Stack (non-negotiable):**
> - **Frontend:** Next.js 14 (App Router) + TypeScript + TailwindCSS + Zustand + TanStack Query + Recharts/TradingView Lightweight Charts
> - **Backend:** Node.js 20+ (TypeScript) + Fastify (or Express) + Socket.IO
> - **DB:** MongoDB 7 (primary store) + Redis 7 (in-memory cache, pub/sub, queues, last-tick store)
> - **Queue:** BullMQ (Redis-backed) for order events, broker reconciliation, backtest jobs
> - **Auth:** JWT (access + refresh) + bcrypt + optional TOTP 2FA
> - **Markets:** NSE/BSE — NIFTY 50, BANK NIFTY, SENSEX, FIN NIFTY, MIDCAP NIFTY (indices + their option chains + futures)
> - **Brokers (pluggable):** Zerodha Kite, Angel One SmartAPI, Upstox, Dhan, Fyers, IIFL — abstracted behind a single `IBrokerAdapter` interface

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS FRONTEND                            │
│  Pages: Dashboard | Strategy Builder | Backtest | Live | Paper |    │
│         Positions | Orders | Broker Connect | Signals | Settings    │
│  WebSocket client (Socket.IO) ──► live ticks, order updates, P&L    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  REST + WebSocket
┌──────────────────────────────▼──────────────────────────────────────┐
│                       NODE.JS API GATEWAY                           │
│  Fastify HTTP + Socket.IO + JWT middleware + rate limiter           │
└──────┬──────────────┬───────────────┬───────────────┬───────────────┘
       │              │               │               │
┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼───────┐ ┌─────▼─────────────┐
│  STRATEGY  │ │  EXECUTION  │ │ MARKET DATA  │ │  BACKTEST ENGINE  │
│  ENGINE    │ │  ENGINE     │ │  SERVICE     │ │  (BullMQ worker)  │
│ (signals,  │ │ (live + sim │ │ (multi-      │ │  (historical      │
│  triggers) │ │  router,    │ │  broker WS,  │ │   replay, vector  │
│            │ │  OMS, risk) │ │  tick fanout)│ │   metrics)        │
└──────┬─────┘ └──────┬──────┘ └──────┬───────┘ └─────┬─────────────┘
       │              │               │               │
       └──────┬───────┴────────┬──────┴───────┬───────┘
              │                │              │
         ┌────▼────┐      ┌────▼─────┐   ┌────▼─────┐
         │ MongoDB │      │  Redis   │   │ Brokers  │
         │ (durable│      │ (ticks,  │   │ (Kite,   │
         │  store) │      │ pubsub,  │   │ Angel,   │
         │         │      │ queues)  │   │ Upstox…) │
         └─────────┘      └──────────┘   └──────────┘
```

### Service responsibilities

| Service | Owns | Talks to |
|---|---|---|
| **API Gateway** | HTTP routing, auth, request validation, Socket.IO server | All internal services |
| **Market Data Service** | Broker WebSocket sessions, token subscription manager, tick normalization, Redis publish | Brokers, Redis |
| **Execution Engine** | OMS (order state machine), live broker router, paper-trade simulator, risk checks | Brokers, Redis, Mongo |
| **Strategy Engine** | Strategy lifecycle (deploy/pause/stop), signal evaluation, entry/exit triggers | Execution, Redis, Mongo |
| **Backtest Engine** | Historical candle replay, vectorized P&L, slippage modeling | Mongo (historical), BullMQ |
| **Signal Service** | Indicator computation (RSI, EMA, VWAP, supertrend, etc.), signal feed | Redis (ticks in), Redis (signals out) |

All services run as workspaces in a single monorepo (pnpm workspaces or Turborepo). In dev they run as separate Node processes; in prod they can be split into containers.

---

## 2. Repository Layout (Monorepo)

```
algo-trading-platform/
├── apps/
│   ├── web/                       # Next.js 14 frontend
│   │   ├── app/                   # App Router pages
│   │   ├── components/
│   │   ├── lib/                   # api client, ws client, hooks
│   │   ├── store/                 # zustand stores
│   │   └── package.json
│   ├── api-gateway/               # Fastify HTTP + Socket.IO
│   ├── market-data-service/       # Broker WS aggregator
│   ├── execution-engine/          # OMS + paper sim + live router
│   ├── strategy-engine/           # Strategy runtime
│   ├── signal-service/            # Indicator/signal computation
│   └── backtest-worker/           # BullMQ worker for backtests
├── packages/
│   ├── shared-types/              # TS types, Zod schemas (orders, ticks, signals)
│   ├── broker-adapters/           # IBrokerAdapter + Kite/Angel/Upstox/Dhan impls
│   ├── indicators/                # Pure TS indicator lib (RSI, EMA, ATR, Supertrend…)
│   ├── db/                        # Mongo connection + models
│   ├── redis-client/              # ioredis wrapper, pubsub helpers
│   └── utils/                     # logger (pino), config (zod-validated env), time utils
├── docker-compose.yml             # mongo, redis, mongo-express, redis-insight
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 3. Data Model (MongoDB)

All collections use Mongoose with strict schemas. Timestamps everywhere. Soft-delete via `deletedAt`.

### 3.1 `users`
```ts
{
  _id, email (unique), passwordHash, name, phone,
  twoFactor: { enabled, secret },
  preferences: { defaultBroker, defaultProductType, theme },
  createdAt, updatedAt
}
```

### 3.2 `brokerAccounts` — one user can link many
```ts
{
  _id, userId, broker: 'zerodha' | 'angelone' | 'upstox' | 'dhan' | 'fyers' | 'iifl',
  label,                         // user-friendly name
  credentials: {                 // encrypted at rest (AES-256-GCM, key in env)
    apiKey, apiSecret, clientCode, password, totpSecret,
    accessToken, refreshToken, accessTokenExpiry
  },
  isActive, isPrimary,
  capabilities: { canTradeEquity, canTradeFNO, canTradeMCX },
  lastLoginAt, lastTokenRefreshAt,
  createdAt, updatedAt
}
```

### 3.3 `instruments` — master contract list (refresh daily 8:00 IST)
```ts
{
  _id, tradingsymbol, exchange,    // NSE, NFO, BSE, BFO, MCX
  instrumentToken,                 // broker-specific numeric token
  brokerTokens: {                  // mapping per broker for cross-broker subscription
    zerodha: number, angelone: string, upstox: string, dhan: string, ...
  },
  segment, instrumentType,          // EQ, FUT, CE, PE, IDX
  name, expiry, strike, lotSize, tickSize,
  underlying,                       // NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCPNIFTY
}
// Indexes: { tradingsymbol, exchange } unique, { underlying, expiry, strike }
```

### 3.4 `strategies`
```ts
{
  _id, userId, name, description,
  type: 'signal-based' | 'time-based' | 'options-strangle' | 'options-straddle' | 'iron-condor' | 'custom',
  mode: 'live' | 'paper' | 'stopped',
  brokerAccountId,                  // which broker to route orders to (null if paper)

  underlying: 'NIFTY' | 'BANKNIFTY' | 'SENSEX' | 'FINNIFTY' | 'MIDCPNIFTY',
  segment: 'index' | 'futures' | 'options',

  // Entry config
  entry: {
    triggerType: 'time' | 'signal' | 'price' | 'indicator',
    time: 'HH:mm',                  // for time-based
    signals: [SignalRef],           // for signal-based
    legs: [LegConfig]               // for options strategies
  },

  // Exit / SL / TP
  exit: {
    stopLoss: { type: 'percent' | 'points' | 'rupees', value },
    target:    { type: 'percent' | 'points' | 'rupees', value },
    trailingSL: { type, value, step },
    timeExit: 'HH:mm',
    reEntry: { enabled, maxAttempts }
  },

  // Risk
  risk: {
    capitalDeployed, maxLossPerDay, maxLossPerTrade, maxPositions,
    lotMultiplier
  },

  schedule: {
    activeDays: ['MON'…'FRI'],
    startTime, endTime, timezone: 'Asia/Kolkata'
  },

  // Runtime
  state: 'idle' | 'running' | 'paused' | 'error',
  lastRunAt, lastError,
  metrics: { totalTrades, winRate, totalPnL, maxDrawdown },

  createdAt, updatedAt
}
```

`LegConfig` (for options strategies):
```ts
{
  legId,
  action: 'BUY' | 'SELL',
  optionType: 'CE' | 'PE',
  strikeSelection: 'ATM' | 'ITM' | 'OTM' | 'closest-premium' | 'delta-based',
  strikeOffset,                    // e.g. +1 for OTM1, -1 for ITM1
  lots,
  expiry: 'current-week' | 'next-week' | 'monthly',
  individualSL, individualTP,
  waitAndTrade: { enabled, type: 'percent', value }   // re-entry on premium retrace
}
```

### 3.5 `orders` — full lifecycle log
```ts
{
  _id, userId, strategyId?, brokerAccountId, mode: 'live' | 'paper',
  brokerOrderId,                   // null until placed live
  tradingsymbol, exchange, instrumentToken,
  side: 'BUY' | 'SELL',
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M',
  product: 'MIS' | 'NRML' | 'CNC',
  validity: 'DAY' | 'IOC',
  quantity, filledQty, pendingQty,
  price, triggerPrice, averagePrice,
  status: 'PENDING' | 'OPEN' | 'COMPLETE' | 'REJECTED' | 'CANCELLED' | 'PARTIAL',
  statusMessage,
  tag,                             // strategy tag for reconciliation
  parentOrderId?,                  // for SL/TP child legs
  placedAt, updatedAt, filledAt
}
// Indexes: { userId, status, placedAt }, { strategyId }, { brokerOrderId } unique sparse
```

### 3.6 `positions` — netted positions (derived, periodically reconciled)
```ts
{
  _id, userId, strategyId?, brokerAccountId, mode,
  tradingsymbol, exchange, instrumentToken,
  netQty, avgPrice, lastPrice, ltp,
  pnl, mtm, realizedPnl, unrealizedPnl,
  legs: [{ orderId, qty, price, side }],
  openedAt, closedAt
}
```

### 3.7 `signals` — saved reusable signal blocks
```ts
{
  _id, userId, name, description,
  indicator: 'EMA' | 'RSI' | 'MACD' | 'VWAP' | 'SUPERTREND' | 'BOLLINGER' | 'ATR' | 'PRICE',
  params: { period, multiplier, source, ... },
  condition: 'crosses-above' | 'crosses-below' | 'greater-than' | 'less-than' | 'between',
  compareTo: { type: 'value' | 'indicator' | 'price', value | indicatorRef },
  timeframe: '1m' | '3m' | '5m' | '15m' | '1h' | '1d',
  isPublic
}
```

### 3.8 `backtests`
```ts
{
  _id, userId, strategyId, status: 'queued' | 'running' | 'done' | 'failed',
  range: { from, to }, timeframe,
  initialCapital, slippageBps, commissionPerOrder,
  progress,                        // 0..1
  results: {
    totalPnL, totalTrades, winRate, avgWin, avgLoss, profitFactor,
    sharpe, sortino, maxDrawdown, maxDDPercent,
    equityCurve: [{ t, equity }],
    trades: [TradeSummary]
  },
  createdAt, completedAt
}
```

### 3.9 `historicalCandles` — for backtests (use time-series collection)
```ts
{
  instrumentToken, timeframe, t (ISODate),
  o, h, l, c, v, oi
}
// Mongo time-series: timeField: 't', metaField: { instrumentToken, timeframe }
```

### 3.10 `auditLog`
```ts
{ _id, userId, action, entity, entityId, before, after, ip, ua, createdAt }
```

---

## 4. Redis Data Layout

Redis is the hot path. **Never** read live ticks from Mongo.

| Key pattern | Type | Purpose | TTL |
|---|---|---|---|
| `tick:last:{instrumentToken}` | Hash | Latest tick: `ltp, vol, oi, ts, bid, ask, change` | none (overwritten) |
| `tick:ohlc:{token}:{tf}` | Hash | Current building candle | 1 day |
| `subs:{broker}:{userId}` | Set | Tokens this user is subscribed to via this broker | none |
| `subs:global` | Set | Union of all tokens any service needs (drives broker WS sub) | none |
| `sub:refcount:{token}` | Integer | How many subscribers — only unsubscribe when 0 | none |
| `strategy:state:{strategyId}` | Hash | Hot runtime state (positions, lastSignal, lockUntil) | none |
| `idempotency:{key}` | String | Order placement idempotency | 24h |
| `rate:order:{userId}` | Integer | Rate-limit counter | 1m sliding |
| `lock:order:{userId}:{symbol}` | String | Redlock — prevent duplicate order placement | 5s |
| `session:{jti}` | String | Refresh token whitelist | refresh TTL |

### Pub/Sub channels
- `ticks.{instrumentToken}` — every normalized tick is published here. Strategy & signal services subscribe.
- `signals.{strategyId}` — signal-service publishes evaluated signals; execution engine subscribes.
- `orders.{userId}` — order status updates; Socket.IO server fans out to client.
- `positions.{userId}` — position updates.
- `broker.events.{brokerAccountId}` — broker-side events (token expired, kill switch).

### BullMQ queues
- `orders:place` — async order placement with retry
- `orders:reconcile` — periodic broker order-book reconciliation
- `backtest:run` — backtest jobs
- `instruments:refresh` — daily 8:00 IST refresh of contract master
- `token:refresh` — broker access token refresh

---

## 5. Broker Adapter Interface

Every broker is wrapped in a class implementing `IBrokerAdapter`. This is the **single most important abstraction** — the rest of the system never imports broker-specific code.

```ts
// packages/broker-adapters/src/IBrokerAdapter.ts
export interface IBrokerAdapter {
  readonly id: BrokerId;

  // --- Auth ---
  login(creds: BrokerCredentials): Promise<{ accessToken: string; refreshToken?: string; expiry: Date }>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: Date }>;
  isTokenValid(creds: BrokerCredentials): Promise<boolean>;

  // --- Contract master ---
  fetchInstruments(): Promise<NormalizedInstrument[]>;

  // --- Orders ---
  placeOrder(req: NormalizedOrderRequest): Promise<{ brokerOrderId: string }>;
  modifyOrder(brokerOrderId: string, patch: Partial<NormalizedOrderRequest>): Promise<void>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  getOrder(brokerOrderId: string): Promise<NormalizedOrder>;
  getOrderBook(): Promise<NormalizedOrder[]>;
  getTradeBook(): Promise<NormalizedTrade[]>;
  getPositions(): Promise<NormalizedPosition[]>;
  getHoldings(): Promise<NormalizedHolding[]>;
  getFunds(): Promise<{ available: number; used: number; total: number }>;

  // --- Market data ---
  getQuote(tokens: string[]): Promise<Record<string, NormalizedQuote>>;
  getHistorical(token: string, from: Date, to: Date, tf: Timeframe): Promise<Candle[]>;

  // --- WebSocket streaming ---
  connectWS(): Promise<void>;
  disconnectWS(): Promise<void>;
  subscribe(tokens: string[], mode: 'ltp' | 'quote' | 'full'): Promise<void>;
  unsubscribe(tokens: string[]): Promise<void>;
  on(event: 'tick' | 'order' | 'connect' | 'disconnect' | 'error', cb: Function): void;
}
```

Implementations live in:
```
packages/broker-adapters/src/
  zerodha/KiteAdapter.ts          # uses kiteconnect npm pkg + KiteTicker for WS
  angelone/AngelOneAdapter.ts     # smartapi-javascript + smart-websocket-v2
  upstox/UpstoxAdapter.ts         # upstox-js-sdk
  dhan/DhanAdapter.ts             # dhanhq npm pkg
  fyers/FyersAdapter.ts           # fyers-api-v3
  index.ts                        # factory: createAdapter(brokerId, creds)
```

### Normalization contract — the single source of truth

All adapters must convert their broker's payloads into these shapes before returning:

```ts
type Tick = {
  instrumentToken: string;        // OUR internal token (from `instruments.brokerTokens`)
  brokerToken: string;            // broker's raw token (for debugging)
  ltp: number;
  ltt: Date;                      // last traded time
  volume: number;
  oi?: number;
  bid?: number; ask?: number;
  bidQty?: number; askQty?: number;
  change?: number; changePercent?: number;
  ohlc?: { o: number; h: number; l: number; c: number };
  depth?: { bids: Level[]; asks: Level[] };
  receivedAt: Date;
  broker: BrokerId;
};

type NormalizedOrderRequest = {
  tradingsymbol: string;
  exchange: 'NSE' | 'BSE' | 'NFO' | 'BFO' | 'MCX';
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
  product: 'MIS' | 'NRML' | 'CNC';
  validity: 'DAY' | 'IOC';
  price?: number;
  triggerPrice?: number;
  disclosedQty?: number;
  tag?: string;
};
```

---

## 6. Market Data Service (the WebSocket layer)

This service is the **only** thing that talks to broker WebSockets. Other services consume ticks via Redis pub/sub.

### 6.1 Lifecycle

```
on boot:
  1. Load all active brokerAccounts from Mongo (where isActive=true and at least one strategy/user is online)
  2. For each, create adapter → connectWS()
  3. Restore subscriptions: for each broker connection, SMEMBERS subs:global → adapter.subscribe(tokens)

on tick received from broker:
  1. normalize → Tick object
  2. HSET tick:last:{token} → ltp, ts, vol, oi, ...
  3. PUBLISH ticks.{token} <serialized tick>
  4. Update building candles (1m, 3m, 5m, 15m, 1h) — store in tick:ohlc:{token}:{tf}, push completed candles to mongo

on subscribe request (from any service via internal API or Redis pubsub channel `subs.request`):
  1. INCR sub:refcount:{token}
  2. SADD subs:global {token}
  3. If refcount transitioned 0→1, call adapter.subscribe([token])

on unsubscribe request:
  1. DECR sub:refcount:{token}
  2. If 0, SREM subs:global {token} and adapter.unsubscribe([token])

on broker WS disconnect:
  1. Exponential backoff reconnect (1s, 2s, 4s, … cap 30s)
  2. After reconnect, re-subscribe all tokens from subs:global
  3. Emit broker.events.{brokerAccountId} → "reconnected"
```

### 6.2 Subscription budget per broker

Each broker has a WS subscription cap (Kite: 3000 tokens per connection; Angel One: 1000; Upstox: 100 in instruments mode; etc.). The service:
- Tracks per-broker capacity from a config table.
- If full, opens a second WS connection (multi-connection pooling) — adapter must support `connectWS()` returning multiple sessions internally.

### 6.3 Underlying-to-tokens helper

Strategies typically say "subscribe to BANKNIFTY weekly options chain". A helper resolves:
```ts
expandUnderlying({
  underlying: 'BANKNIFTY',
  segment: 'options',
  expiry: 'current-week',
  strikeRange: { atmOffset: { from: -10, to: +10 } }
}) → list of instrumentTokens
```

This expansion uses the `instruments` collection. Auto-resolves ATM from spot's `tick:last:{spotToken}`.

### 6.4 Tick → candle aggregator

Run in-process (not as separate service). On every tick:
- Read current building candle from `tick:ohlc:{token}:{tf}` for each timeframe (1m, 3m, 5m, 15m, 1h).
- Update H/L/C/V. If candle's minute boundary crossed, finalize → write to `historicalCandles` collection and publish `candles.{token}.{tf}`.

---

## 7. Execution Engine

The execution engine implements an **Order Management System (OMS)** that treats live and paper trading identically except for the final dispatch hop.

### 7.1 Order state machine

```
   ┌────────┐  validate    ┌─────────┐  send    ┌────────┐
   │ DRAFT  ├─────────────►│ QUEUED  ├─────────►│ SENT   │
   └────────┘   risk fail  └────┬────┘   error  └───┬────┘
                  │             │ reject           ▼
                  ▼             ▼              ┌────────┐
              REJECTED      REJECTED           │  OPEN  │
                                               └───┬────┘
                                            partial│ fill
                                          ┌────────┼────────┐
                                          ▼        ▼        ▼
                                      PARTIAL  COMPLETE  CANCELLED
```

Every transition is persisted to `orders.statusHistory[]` and published on `orders.{userId}`.

### 7.2 Risk pre-checks (run before SENT)

Block the order with a clear reason if any fails:

- `margin`: required margin ≤ available funds (call `adapter.getFunds()`)
- `daily-loss-cap`: today's realized + unrealized P&L > `-maxLossPerDay` ⇒ block
- `position-cap`: strategy already has `maxPositions` open
- `per-trade-loss`: SL distance × qty × lot > `maxLossPerTrade`
- `instrument-allowed`: instrument is in user's allowed-segments list
- `square-off-time`: now > strategy.exit.timeExit ⇒ block new entries
- `kill-switch`: `strategy:state:{id}.killSwitch === 1` ⇒ block all
- `freeze-quantity`: NSE freeze qty per leg (NIFTY 1800, BANKNIFTY 900, etc. — store in a config table)

### 7.3 Live vs paper router

```ts
class OrderRouter {
  async place(req: NormalizedOrderRequest, ctx: OrderContext) {
    await this.riskGate.check(req, ctx);
    const order = await this.persistDraft(req, ctx);

    if (ctx.mode === 'paper') {
      return this.paperSim.execute(order);
    }

    const adapter = await this.adapterFactory.for(ctx.brokerAccountId);
    const { brokerOrderId } = await adapter.placeOrder(req);
    await this.markSent(order._id, brokerOrderId);
    return order;
  }
}
```

### 7.4 Paper trade simulator

Mirrors live behavior with these rules:
- **Market order:** fills at `tick:last:{token}.ltp` plus slippage (default 1 tick adverse, configurable).
- **Limit order:** sits in an in-memory book keyed by token; fills when next tick crosses limit. Persists to Mongo via Redis sorted set `paper:limits:{token}` (score = price).
- **SL / SL-M:** triggers when next tick crosses trigger price; converts to market or limit accordingly.
- **Brokerage simulation:** apply configurable per-leg brokerage + STT + exchange charges + GST so equity curve matches real-world.
- Publishes the same `orders.{userId}` events as live, so the frontend cannot tell them apart.

### 7.5 Bracket / cover order emulation

Many brokers no longer support native BO/CO. Implement client-side:
- When strategy specifies SL + TP, the engine:
  1. Places entry as a regular order.
  2. On COMPLETE event, places a SELL/BUY at trigger = SL (SL order) AND a SELL/BUY at TP (LIMIT). Both with `parentOrderId = entry._id`.
  3. **OCO logic:** whichever of SL/TP fills first, the other is cancelled immediately (subscribe `orders.{userId}` internally).
  4. Trailing SL handler: on every tick to `tick:last:{token}`, recompute SL trigger and call `adapter.modifyOrder()` if shifted by ≥ `trailingSL.step`.

### 7.6 Order placement idempotency

Each order placement attempt carries a client-generated `idempotencyKey = sha256(strategyId|leg|signalTimestamp)`. Stored in Redis `idempotency:{key}` with 24h TTL. Duplicates return the original order.

### 7.7 Reconciliation worker

Every 10 seconds (and on every broker WS order event):
- Pull `getOrderBook()` from each connected broker.
- Diff against Mongo orders with `brokerOrderId IN (…)`. Update statuses, fills, average price.
- Recompute positions from completed orders. Publish `positions.{userId}`.

---

## 8. Strategy Engine

A long-running supervisor that loads every strategy with `mode IN ['live','paper']` and `state = 'running'` and ticks them.

### 8.1 Strategy runtime

```ts
class StrategyRuntime {
  constructor(private strategy: Strategy) {}

  async start() {
    // 1. Resolve instruments (e.g. expand options chain)
    this.tokens = await resolveInstruments(this.strategy);

    // 2. Ask market-data-service to subscribe
    await subBus.request({ action: 'subscribe', tokens: this.tokens });

    // 3. Connect to relevant Redis pub/sub channels
    for (const t of this.tokens) redis.subscribe(`ticks.${t}`);
    for (const s of this.strategy.entry.signals) redis.subscribe(`signals.${s._id}`);

    // 4. Schedule time-based triggers (cron) if any
    if (this.strategy.entry.triggerType === 'time') {
      schedule(this.strategy.entry.time, () => this.onEntryTime());
    }
  }

  onTick(tick: Tick) { /* update SL trail, time-exit check, MTM */ }
  onSignal(sig: Signal) { /* if entry conditions met → submit order via execution engine */ }
  onEntryTime() { /* fire entry legs for options strategies */ }
}
```

### 8.2 Built-in strategy templates

The frontend exposes these as drag-and-build templates; backend stores them as concrete `strategies` documents.

1. **Time-based options strangle** — sell OTM CE + OTM PE at 9:20, SL 30% per leg, exit 15:15.
2. **Iron condor** — sell ATM strangle + buy further OTM wings.
3. **Signal-based intraday** — e.g. "Buy NIFTY FUT when 5m RSI(14) crosses above 60 AND EMA(20) > EMA(50); SL 0.5%, TP 1%."
4. **Premium-based ATM straddle** — sell CE+PE closest to a target premium.
5. **Directional options buying** — buy CE/PE on supertrend flip.

### 8.3 Re-entry & "wait and trade"

- **Re-entry on SL hit:** after SL, the leg waits for re-entry condition (`type: 'cost' → re-enter when premium returns to entry; type: 'momentum' → re-enter on signal`). `entry.reEntry.maxAttempts` caps it.
- **Wait and trade:** if user wants to short a strike at "10% above current premium", the engine places a sleeping order; when LTP ≥ trigger, it fires the actual entry.

---

## 9. Signal Service

Stateless evaluator that consumes ticks → emits signals.

### 9.1 Indicator library (pure functions, no I/O)
Implement in `packages/indicators`:
- SMA, EMA, WMA
- RSI (Wilder's smoothing)
- MACD (12, 26, 9)
- Bollinger Bands
- ATR (Wilder)
- Supertrend (ATR × multiplier)
- VWAP (session-anchored, resets at 09:15 IST)
- ADX, +DI/-DI
- Stochastic (%K, %D)
- Pivot points (classic + Camarilla + Fibonacci)
- Open range high/low (configurable window from 09:15)

All accept `(candles: Candle[], params): IndicatorSeries` and are testable with vitest.

### 9.2 Signal evaluator

For each signal config (e.g. `EMA(20) crosses-above EMA(50) on 5m`):
1. On candle close event for the relevant timeframe → recompute indicator on last N candles (read from `historicalCandles` for warmup + in-memory rolling window).
2. Evaluate condition. If true and not already-firing → publish `signals.{signalId}` with payload `{ts, value, comparedTo, candleTimeframe}`.

### 9.3 Warmup

On boot, every signal pulls the last `max(period*5, 200)` candles from Mongo to seed the rolling window before processing live ticks.

---

## 10. Backtest Engine

Runs as a BullMQ worker so users can fire-and-forget large backtests.

### 10.1 Inputs
- `strategyId` (the strategy doc is the source of truth)
- date range, timeframe
- initial capital, slippage (bps), commission per order
- option chain data must be available for the range (pre-loaded via broker historical APIs)

### 10.2 Algorithm

```
for each minute (or smallest tf) from->to:
  - emit candle to indicator buffers
  - on candle close for each strategy timeframe, recompute signals
  - run strategy's onSignal/onEntryTime logic — produce virtual orders
  - virtual order book mark-to-market vs candle high/low for SL/TP triggers
  - apply slippage + brokerage
  - update equity, drawdown, trade log
periodically write progress 0..1 to Redis backtest:progress:{backtestId}
```

### 10.3 Metrics computed
Total P&L, total trades, win rate, avg win/loss, profit factor, expectancy, Sharpe (sqrt(252)), Sortino, Calmar, max DD (₹ and %), longest losing streak, equity curve, per-trade log.

### 10.4 Result delivery
Persist to `backtests.results`. Frontend polls (or subscribes Socket.IO room `backtest:{id}`) for progress and renders charts (equity curve, drawdown curve, monthly heatmap, trade scatter).

---

## 11. REST API Surface (Fastify)

All routes prefixed `/api/v1`. JWT required except `/auth/*`. Use Zod for body validation.

### 11.1 Auth
- `POST /auth/register` `{email, password, name}`
- `POST /auth/login` → `{accessToken, refreshToken}`
- `POST /auth/refresh` `{refreshToken}`
- `POST /auth/logout`
- `POST /auth/2fa/enable`, `/auth/2fa/verify`

### 11.2 Broker
- `GET    /brokers` — list supported brokers + capabilities
- `GET    /brokers/accounts`
- `POST   /brokers/accounts` `{broker, label, credentials}` — encrypts + tries login
- `POST   /brokers/accounts/:id/refresh-token`
- `DELETE /brokers/accounts/:id`
- `GET    /brokers/accounts/:id/funds`
- `GET    /brokers/accounts/:id/positions`
- `GET    /brokers/accounts/:id/holdings`
- `GET    /brokers/accounts/:id/orderbook`

### 11.3 Instruments
- `GET /instruments/search?q=NIFTY24OCT24500CE&exchange=NFO&limit=20`
- `GET /instruments/options-chain?underlying=BANKNIFTY&expiry=2024-10-31`
- `POST /instruments/refresh` (admin)

### 11.4 Strategies
- `GET /strategies`
- `POST /strategies`
- `PUT /strategies/:id`
- `DELETE /strategies/:id`
- `POST /strategies/:id/deploy` `{mode: 'live'|'paper'}`
- `POST /strategies/:id/pause`
- `POST /strategies/:id/stop`
- `POST /strategies/:id/squareoff` — force-close all positions for this strategy

### 11.5 Signals
- CRUD `/signals` + `/signals/templates` (library of presets)
- `GET /signals/:id/current-value?token=…`

### 11.6 Orders
- `GET  /orders?status=&strategyId=&from=&to=`
- `POST /orders` — manual order placement (bypass strategy)
- `PUT  /orders/:id` — modify
- `DELETE /orders/:id` — cancel

### 11.7 Positions
- `GET /positions?mode=live|paper`
- `POST /positions/:id/squareoff`

### 11.8 Backtests
- `POST /backtests` — enqueue
- `GET  /backtests/:id` — status + result
- `GET  /backtests?strategyId=&limit=`

### 11.9 Market data
- `GET /md/quote?tokens=…` — pulls from Redis `tick:last:*`
- `GET /md/candles?token=&tf=&from=&to=` — Mongo `historicalCandles`

---

## 12. WebSocket Surface (Socket.IO)

Server in api-gateway. Auth via JWT in `socket.handshake.auth.token`.

### Rooms a client joins automatically after auth:
- `user:{userId}` — orders, positions, P&L
- `strategy:{strategyId}` — per-strategy events

### Rooms a client can request:
- `tick:{instrumentToken}` — emits forwarded `ticks.{token}` Redis messages (with throttle: max 5 msgs/sec/client/token to protect frontend)
- `candle:{token}:{tf}` — completed candles
- `backtest:{id}` — backtest progress

### Outbound events
| Event | Payload |
|---|---|
| `tick` | normalized Tick |
| `order:update` | order doc |
| `position:update` | position doc |
| `strategy:state` | `{strategyId, state, lastError}` |
| `pnl:update` | `{realized, unrealized, mtm}` (every 1s aggregated) |
| `signal` | `{signalId, value, ts}` |
| `backtest:progress` | `{id, progress, partialMetrics}` |

The gateway subscribes once per Redis channel and fans out to all relevant Socket.IO rooms — never one Redis sub per client.

---

## 13. Frontend (Next.js 14 App Router)

### 13.1 Routes
```
/                           Marketing landing
/login                      /register
/dashboard                  KPI tiles, P&L sparkline, open positions, today's signals
/strategies                 list + grid
/strategies/new             builder
/strategies/[id]            detail + deploy controls
/backtest                   builder + history
/backtest/[id]              result viewer with equity/DD charts
/paper                      paper trading dashboard
/live                       live trading dashboard
/positions                  live netted positions
/orders                     order book / trade book
/signals                    saved signals
/brokers                    connected broker accounts
/instruments                option chain explorer + watchlist
/settings                   profile, 2FA, API keys
```

### 13.2 Strategy Builder UX

Two side-by-side modes:

**Visual mode** — block-based:
- Underlying picker (NIFTY/BANKNIFTY/SENSEX/FINNIFTY/MIDCPNIFTY)
- Segment toggle (Index / Futures / Options)
- For options: add legs (BUY/SELL, CE/PE, strike selector: ATM / ATM±N / closest-premium / delta)
- Entry triggers: time | signal | combo
- Risk panel: SL, TP, trailing SL, max loss/day, lots
- Exit: square-off time, exit-on-signal, re-entry rules

**Code mode** — JSON view of the strategy doc, for power users.

Save → POST `/strategies`. Deploy button → POST `/strategies/:id/deploy` with mode toggle (live vs paper).

### 13.3 Live dashboard widgets
- **Live ticks ticker** — joins `tick:{token}` rooms for all current positions
- **Open positions table** — colored P&L
- **Order book pane** — auto-updating via `user:{userId}` room
- **Per-strategy P&L card** with Pause / Stop / Square-off buttons
- **Charts** — Lightweight Charts with overlayed entry/exit markers from order events

### 13.4 State management
- **Server state:** TanStack Query, 30s default stale time, websocket invalidations on `order:update`/`position:update`.
- **UI state:** Zustand (selected strategy, modal open, etc.).
- **Realtime stream:** custom `useSocket()` hook — single Socket.IO instance shared via React context.

### 13.5 Charts
Use **TradingView Lightweight Charts** for OHLC + indicator overlays. Plot trade markers (arrows) from the orders feed. Use Recharts for equity curve + drawdown in backtests.

---

## 14. Security

- Passwords: bcrypt cost 12.
- JWT access token 15m, refresh 7d (rotating, stored in Redis whitelist).
- Broker credentials encrypted at rest with AES-256-GCM; key from `BROKER_ENC_KEY` env (32 bytes, base64).
- HTTPS only in prod; HSTS headers via Fastify helmet.
- CORS allowlist via env.
- Rate limits: 60 req/min/IP global, 10 order/min/user, configurable.
- Audit log every order and credential mutation.
- Never log full credentials or access tokens — redact with pino's redact paths.

---

## 15. Configuration / Env

`.env.example`:
```
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/algotrade
REDIS_URI=redis://localhost:6379

JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

BROKER_ENC_KEY=base64-32-bytes

# Per-broker keys (only what is needed — most are user-supplied at connect time)
ZERODHA_APP_ID=
ANGELONE_API_KEY=
UPSTOX_API_KEY=
DHAN_CLIENT_ID=
FYERS_APP_ID=

PORT_API=4000
PORT_MARKET_DATA=4001
PORT_EXECUTION=4002
PORT_STRATEGY=4003
PORT_SIGNAL=4004

LOG_LEVEL=info
TZ=Asia/Kolkata
```

`packages/utils/config.ts` parses env via Zod and throws at boot if invalid.

---

## 16. Time, Sessions, Holidays

- All scheduling/cron uses `node-cron` or `croner` with timezone `Asia/Kolkata`.
- NSE/BSE market hours: 09:15–15:30 (equity), 09:00–17:00 (currency), 09:00–23:30 (commodities — MCX).
- Pre-open: 09:00–09:08. Strategies must not place orders before market open unless explicitly allowed.
- Maintain a `marketHolidays` collection refreshed yearly; skip strategy execution on holidays.

---

## 17. Local Dev — docker-compose.yml (sketch)

```yaml
services:
  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: [mongo-data:/data/db]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --appendonly yes
    volumes: [redis-data:/data]
  mongo-express:
    image: mongo-express
    ports: ["8081:8081"]
    environment: { ME_CONFIG_MONGODB_SERVER: mongo }
  redis-insight:
    image: redis/redisinsight:latest
    ports: ["5540:5540"]
volumes: { mongo-data: {}, redis-data: {} }
```

Boot order in dev:
1. `docker compose up -d`
2. `pnpm install`
3. `pnpm --filter @app/api-gateway dev` (and similarly for other apps), or `pnpm dev` at root via Turborepo.

---

## 18. Testing Strategy

- **Unit:** Vitest for indicators, paper-trade simulator, OMS state machine, risk gates, normalization.
- **Integration:** spin up Mongo + Redis test containers via testcontainers; test full order placement through a `MockBrokerAdapter`.
- **Contract:** every real broker adapter must pass the same `IBrokerAdapter` test suite (mock the HTTP layer with `msw` / `nock` and replay recorded broker responses).
- **E2E (frontend):** Playwright — login → create strategy → deploy paper → see fake fill → square-off.

A `MockBrokerAdapter` lives in `packages/broker-adapters/src/mock/` and is used as the default in dev so the full stack runs without any real broker creds.

---

## 19. Observability

- **Logs:** pino with request-id correlation; one structured log line per request and per order state transition.
- **Metrics:** Prometheus client — counters (orders_placed, ticks_received), histograms (order_latency_ms, ws_reconnect_count), gauges (ws_active_subs).
- **Tracing:** OpenTelemetry SDK (optional in dev, recommended in prod) — propagate trace IDs from HTTP → BullMQ jobs.
- **Healthchecks:** `/healthz` (liveness), `/readyz` (Mongo + Redis ping + at least one broker WS connected).

---

## 20. Deployment Notes (so Claude Code can generate them)

- Docker images per service, multi-stage (deps → build → runtime distroless).
- One Postgres-equivalent durable disk for Mongo; Redis with AOF persistence + daily snapshots.
- Run multiple replicas of api-gateway and strategy-engine behind a load balancer; market-data-service should be **singleton per broker account** (use a Redis lock to guarantee).
- Use Kubernetes StatefulSet for market-data-service for stable identity, or a leader-election pattern (Redlock) on plain Docker.

---

## 21. Build Order for Claude Code

Hand this section to the agent so it builds in working chunks:

1. **Bootstrap:** monorepo, pnpm workspaces, Turborepo, TS configs, ESLint, Prettier, vitest, docker-compose.
2. **`packages/shared-types` + `packages/utils`:** Zod schemas, config, logger.
3. **`packages/db` + `packages/redis-client`:** Mongoose models from §3, Redis wrapper from §4.
4. **`packages/broker-adapters`:** `IBrokerAdapter`, `MockBrokerAdapter`, then `KiteAdapter` (most documented), then add others incrementally.
5. **`apps/market-data-service`:** subscription manager, tick fanout, candle aggregator.
6. **`packages/indicators` + `apps/signal-service`:** indicator lib + signal evaluator.
7. **`apps/execution-engine`:** OMS, risk gates, paper sim, live router, reconciliation worker.
8. **`apps/strategy-engine`:** strategy runtime + supervisor.
9. **`apps/backtest-worker`:** BullMQ worker + metrics.
10. **`apps/api-gateway`:** REST routes, Socket.IO, JWT, rate limits.
11. **`apps/web`:** Next.js app — auth pages → dashboard → strategies CRUD → builder → live/paper dashboards → backtest UI.
12. **Tests + seed data + README.**

At each step: write code, write tests, ensure `pnpm test` and `pnpm build` are green, then move on.

---

## 22. Acceptance Criteria (Definition of Done)

The platform is "done" when:

- A new user can register, log in, connect a Zerodha account (or use `MockBroker` in dev), and see funds.
- User can build a signal-based strategy (e.g. EMA-cross on NIFTY 5m) in the visual builder and save it.
- User can deploy that strategy in **paper** mode and see simulated orders fill against live ticks.
- User can switch the same strategy to **live** mode and a real order goes to the broker (verified end-to-end on Kite sandbox or with a tiny lot).
- Subscribing to NIFTY / BANKNIFTY / SENSEX / FIN NIFTY / MIDCAP NIFTY (and any option strike) via the Market Data Service produces ticks on the frontend within < 200 ms of broker emission.
- A 1-year backtest of a multi-leg options strangle completes in under 60 s on a dev machine and renders the equity curve.
- All services reconnect automatically after Redis or broker WS disconnects without manual intervention.
- 100% of broker calls flow through `IBrokerAdapter` (grep proves it).
- `pnpm test` passes; `pnpm build` produces deployable bundles.

---

**End of specification.** Hand this entire file to Claude Code with the instruction:
> *"Implement this specification end-to-end. Start with section 21 (Build Order). At each step, write code + tests, then continue. Do not skip the `IBrokerAdapter` abstraction. Use `MockBrokerAdapter` as the default in dev so the whole stack runs without real broker credentials."*
