import { NotImplementedAdapter } from '../NotImplementedAdapter.js';

/**
 * Fyers API v3 adapter.
 *
 * Required deps: pnpm add fyers-api-v3
 */
export class FyersAdapter extends NotImplementedAdapter {
  readonly id = 'fyers' as const;
}
