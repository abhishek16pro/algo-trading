import { EventEmitter } from 'node:events';
import type { BrokerEventHandlers, IBrokerAdapter } from './IBrokerAdapter.js';

/** Provides typed `.on()` for adapters. Concrete subclasses emit via `this.emitter`. */
export abstract class BaseAdapter implements Pick<IBrokerAdapter, 'on'> {
  protected readonly emitter = new EventEmitter();

  on<K extends keyof BrokerEventHandlers>(event: K, cb: NonNullable<BrokerEventHandlers[K]>): void {
    this.emitter.on(event, cb as (...args: unknown[]) => void);
  }
}
