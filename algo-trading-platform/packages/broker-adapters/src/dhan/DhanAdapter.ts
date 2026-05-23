import { NotImplementedAdapter } from '../NotImplementedAdapter.js';

/**
 * Dhan adapter (DhanHQ API).
 *
 * Required deps: pnpm add dhanhq
 */
export class DhanAdapter extends NotImplementedAdapter {
  readonly id = 'dhan' as const;
}
