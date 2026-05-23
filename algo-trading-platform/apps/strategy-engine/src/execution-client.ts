import type { RedisPubSub } from '@algo/redis-client';
import type { NormalizedOrderRequest } from '@algo/shared-types';

export type PlaceOrderMsg = {
  req: NormalizedOrderRequest;
  ctx: {
    userId: string;
    brokerAccountId: string;
    mode: 'live' | 'paper';
    strategyId?: string;
  };
};

/**
 * Inter-service contract: strategy-engine asks execution-engine to place an order by publishing
 * on `exec:place`. Execution-engine subscribes and runs through OrderRouter.
 *
 * This is an at-least-once fire-and-forget channel; idempotency is enforced inside OrderRouter via
 * `idempotencyKey`. If you need ack semantics, switch to a BullMQ queue.
 */
export async function placeOrderViaEngine(pubsub: RedisPubSub, msg: PlaceOrderMsg): Promise<void> {
  await pubsub.publish('exec:place', msg);
}
