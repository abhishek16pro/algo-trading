import { NotImplementedAdapter } from '../NotImplementedAdapter.js';

/**
 * Zerodha Kite Connect adapter.
 *
 * Required deps when implementing live trading:
 *   pnpm add kiteconnect
 *
 * Endpoints to map (see kite.trade docs):
 *  - REST: https://api.kite.trade
 *  - WS  : wss://ws.kite.trade  (KiteTicker)
 *
 * Subscription cap: 3000 tokens per WS connection — pool connections if exceeded.
 * Historical candles: timeframes minute, 3minute, 5minute, 15minute, 30minute, 60minute, day.
 */
export class KiteAdapter extends NotImplementedAdapter {
  readonly id = 'zerodha' as const;
}
