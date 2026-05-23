import type { BrokerId } from '@algo/shared-types';
import type { AdapterFactoryOptions, IBrokerAdapter } from './IBrokerAdapter.js';
import { MockBrokerAdapter } from './mock/MockBrokerAdapter.js';
import { KiteAdapter } from './kite/KiteAdapter.js';
import { AngelOneAdapter } from './angelone/AngelOneAdapter.js';
import { UpstoxAdapter } from './upstox/UpstoxAdapter.js';
import { DhanAdapter } from './dhan/DhanAdapter.js';
import { FyersAdapter } from './fyers/FyersAdapter.js';

/**
 * The single entry point for instantiating broker adapters. The rest of the system MUST go
 * through here; `grep "new KiteAdapter"` should only ever match this file.
 */
export function createAdapter(broker: BrokerId, opts: AdapterFactoryOptions): IBrokerAdapter {
  switch (broker) {
    case 'mock':
      return new MockBrokerAdapter();
    case 'zerodha':
      return new KiteAdapter(opts);
    case 'angelone':
      return new AngelOneAdapter(opts);
    case 'upstox':
      return new UpstoxAdapter(opts);
    case 'dhan':
      return new DhanAdapter(opts);
    case 'fyers':
      return new FyersAdapter(opts);
    case 'iifl':
      throw new Error('IIFL adapter not yet implemented');
    default: {
      const _exhaustive: never = broker;
      throw new Error(`Unknown broker: ${_exhaustive as string}`);
    }
  }
}
