# Architecture

High-level map for engineers joining the codebase. For the full spec see [../algo-trading-engine.md](../algo-trading-engine.md).

## Service topology

```
┌─────────────────────────────────────────────────────────────┐
│                     apps/web (Next.js)                       │
│     REST → api-gateway      Socket.IO → api-gateway          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  apps/api-gateway (Fastify)                  │
│ JWT auth · rate limit · REST · Socket.IO server              │
└────────┬───────────────────┬───────────────────────┬─────────┘
         │                   │                       │
         │       Redis pub/sub (channels.*)          │
         ▼                   ▼                       ▼
┌──────────────┐  ┌────────────────┐  ┌────────────────────┐
│ strategy-    │  │ execution-     │  │  market-data-      │
│ engine       │  │ engine         │  │  service           │
│ (supervisor) │  │ (OMS + paper + │  │  (broker WS →      │
│              │  │ live router +  │  │   tick fanout +    │
│              │  │ bracket OCO +  │  │   candle builder)  │
│              │  │ reconciler)    │  │                    │
└──────────────┘  └────────────────┘  └────────────────────┘
         │                   │                       │
         └────────────┬──────┴───────────────┬───────┘
                      ▼                      ▼
              ┌────────────┐         ┌────────────┐
              │  MongoDB   │         │   Redis    │
              │ (durable)  │         │  (hot)     │
              └────────────┘         └────────────┘
```

Every broker call funnels through `packages/broker-adapters/src/factory.ts → createAdapter(...)`. Grep proves it:

```bash
grep -RE "new (Kite|AngelOne|Upstox|Dhan|Fyers)Adapter" --include='*.ts' --exclude-dir=node_modules
# Should match only factory.ts.
```

## Inter-service contracts

All cross-service communication is via Redis pub/sub. Channel names live in `@algo/shared-types/events.ts → channels`. Use those helpers; never hand-write channel strings.

| Channel | Producer | Consumer |
|---|---|---|
| `ticks.{token}` | market-data | strategy, signal, api-gateway (Socket.IO) |
| `signals.{signalId}` | signal-service | strategy-engine |
| `orders.{userId}` | execution-engine | api-gateway (Socket.IO) |
| `positions.{userId}` | execution-engine | api-gateway (Socket.IO) |
| `candles.{token}.{tf}` | market-data | signal-service, api-gateway |
| `strategy.state.{strategyId}` | api-gateway | strategy-engine (supervisor) |
| `exec:place` | strategy-engine, api-gateway | execution-engine |
| `exec:cancel` | strategy-engine, api-gateway | execution-engine |
| `subs.request` | strategy-engine | market-data-service |

## Order lifecycle

```
DRAFT → (risk-gate) → REJECTED   (terminal)
              │
              ▼
           QUEUED → (dispatch) → SENT → PENDING → OPEN
                                         │         │
                                         │   ┌─────┼──────┐
                                         │   ▼     ▼      ▼
                                         │ PARTIAL COMPLETE CANCELLED
                                         │   │
                                         ▼   ▼
                                       REJECTED
```

Every transition appends to `orders.statusHistory[]` and publishes `orders.{userId}`.

## Idempotency

Every order placement carries an `idempotencyKey = sha256(strategyId | leg | side | qty | tag | minute)`. Stored on the order doc and indexed unique sparse — a replay returns the original order rather than placing a duplicate. See `OrderRouter.place()` in `apps/execution-engine/src/order-router.ts`.

## Reconnection

* **Broker WS:** market-data-service reconnects with exponential backoff (1s → 30s cap). On reconnect, subscriptions in `subs:global` are re-established.
* **Redis:** ioredis reconnects automatically; services do not exit on transient errors.
* **Strategy state:** kept in `strategy:state:{id}` so restarting strategy-engine resumes without losing dailyPnL, killSwitch, etc.

## Tests

Run from the root:

```bash
pnpm test
```

Pure-logic packages (`indicators`, `utils`) have full unit coverage. The `MockBrokerAdapter` has a contract suite (`packages/broker-adapters/src/__tests__/mock-adapter.test.ts`) that every real adapter must also satisfy. Integration tests that need Mongo/Redis should use `testcontainers` (not yet wired — V2).

## Adding a new broker

1. Create `packages/broker-adapters/src/<broker>/<Broker>Adapter.ts` extending `NotImplementedAdapter`.
2. Implement methods method-by-method. Each must return *normalized* shapes (`@algo/shared-types`).
3. Register in `packages/broker-adapters/src/factory.ts`.
4. Add a copy of `mock-adapter.test.ts` adapted to your adapter — pass all the same scenarios.
5. Document subscription cap, instrument-token format, and auth flow at the top of the file.
