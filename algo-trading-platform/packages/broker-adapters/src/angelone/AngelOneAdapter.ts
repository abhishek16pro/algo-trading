import { NotImplementedAdapter } from '../NotImplementedAdapter.js';

/**
 * Angel One SmartAPI adapter.
 *
 * Required deps: pnpm add smartapi-javascript smart-websocket-v2
 *
 * Subscription cap: 1000 tokens per WS connection.
 * Auth: TOTP-based session flow against https://apiconnect.angelone.in.
 */
export class AngelOneAdapter extends NotImplementedAdapter {
  readonly id = 'angelone' as const;
}
