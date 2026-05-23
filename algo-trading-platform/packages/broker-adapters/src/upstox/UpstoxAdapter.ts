import { NotImplementedAdapter } from '../NotImplementedAdapter.js';

/**
 * Upstox API v2 adapter.
 *
 * Required deps: pnpm add upstox-js-sdk
 *
 * Subscription cap: 100 instrument keys in `instruments` mode per connection.
 */
export class UpstoxAdapter extends NotImplementedAdapter {
  readonly id = 'upstox' as const;
}
