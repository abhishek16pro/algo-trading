# Algo Trading Platform

A production-grade, multi-broker Indian algorithmic trading platform inspired by AlgoTest.

## Features

- Multi-broker support (Zerodha Kite, Angel One, Upstox, Dhan, Fyers, IIFL) behind a single `IBrokerAdapter` abstraction
- Signal-based, time-based, and options strategy templates (strangle, iron condor, straddle, directional)
- Backtesting engine with vectorized P&L, slippage, brokerage modeling
- Paper trading simulator that mirrors live behavior exactly
- Live execution with OMS, risk pre-checks, bracket-order emulation, OCO logic
- Real-time market data via broker WebSocket, fanned out via Redis pub/sub
- Next.js 14 frontend (App Router) with strategy builder, live dashboard, backtest viewer

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind, Zustand, TanStack Query, Lightweight Charts |
| Backend | Node.js 20+, Fastify, Socket.IO, BullMQ |
| Datastores | MongoDB 7, Redis 7 |
| Auth | JWT (access + refresh), bcrypt, optional TOTP 2FA |
| Tooling | pnpm workspaces, Turborepo, Vitest, ESLint, Prettier |

## Architecture

See [algo-trading-engine.md](../algo-trading-engine.md) for the full architecture spec.

```
apps/
  web/                  Next.js 14 frontend
  api-gateway/          Fastify HTTP + Socket.IO
  market-data-service/  Broker WS aggregator + tick fanout
  execution-engine/     OMS + paper sim + live router
  strategy-engine/      Strategy runtime + supervisor
  signal-service/       Indicator / signal computation
  backtest-worker/      BullMQ worker for backtests
packages/
  shared-types/         TS types + Zod schemas
  broker-adapters/      IBrokerAdapter + Mock/Kite/AngelOne/...
  indicators/           Pure-TS indicator library
  db/                   Mongoose models
  redis-client/         ioredis wrapper + pubsub helpers
  utils/                logger, config, time, crypto
```

## Quickstart

```bash
# 1. Start infra
pnpm infra:up

# 2. Install deps
pnpm install

# 3. Copy env
cp .env.example .env

# 4. Seed mock instruments
pnpm seed

# 5. Run everything
pnpm dev
```

By default `DEFAULT_BROKER=mock` so the full stack runs without real broker credentials.

## Service ports

| Service | Port |
|---|---|
| api-gateway | 4000 |
| market-data-service | 4001 |
| execution-engine | 4002 |
| strategy-engine | 4003 |
| signal-service | 4004 |
| web (Next.js) | 3000 |
| MongoDB | 27017 |
| Redis | 6379 |
| mongo-express | 8081 |
| RedisInsight | 5540 |

## Testing

```bash
pnpm test         # all packages
pnpm typecheck    # tsc --noEmit across workspaces
pnpm lint         # eslint
pnpm build        # turbo build
```
