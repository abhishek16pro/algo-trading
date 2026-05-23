import { BrokerAccountModel } from '@algo/db';
import { createAdapter, type IBrokerAdapter } from '@algo/broker-adapters';
import type { BrokerCredentials, BrokerId } from '@algo/shared-types';
import { decrypt, type Logger } from '@algo/utils';

/**
 * Caches IBrokerAdapter instances per brokerAccountId. Decrypts credentials lazily on first use.
 *
 * Multiple services (execution-engine, strategy-engine) each have their own registry; market-data
 * keeps its own connections too. That's intentional — separation of concerns so a broker WS in the
 * market-data process can't accidentally place orders.
 */
export class AdapterRegistry {
  private cache = new Map<string, IBrokerAdapter>();

  constructor(private readonly log: Logger, private readonly encKey: string) {}

  async for(brokerAccountId: string): Promise<IBrokerAdapter> {
    const cached = this.cache.get(brokerAccountId);
    if (cached) return cached;

    if (brokerAccountId === 'dev-mock') {
      const adapter = createAdapter('mock', { brokerAccountId, credentials: {} });
      this.cache.set(brokerAccountId, adapter);
      return adapter;
    }

    const acc = await BrokerAccountModel.findById(brokerAccountId).lean();
    if (!acc) throw new Error(`Broker account ${brokerAccountId} not found`);

    const creds: BrokerCredentials = {
      apiKey: acc.credentials?.apiKey ? decrypt(acc.credentials.apiKey, this.encKey) : undefined,
      apiSecret: acc.credentials?.apiSecret
        ? decrypt(acc.credentials.apiSecret, this.encKey)
        : undefined,
      clientCode: acc.credentials?.clientCode
        ? decrypt(acc.credentials.clientCode, this.encKey)
        : undefined,
      password: acc.credentials?.password ? decrypt(acc.credentials.password, this.encKey) : undefined,
      totpSecret: acc.credentials?.totpSecret
        ? decrypt(acc.credentials.totpSecret, this.encKey)
        : undefined,
      accessToken: acc.credentials?.accessToken
        ? decrypt(acc.credentials.accessToken, this.encKey)
        : undefined,
      refreshToken: acc.credentials?.refreshToken
        ? decrypt(acc.credentials.refreshToken, this.encKey)
        : undefined,
      accessTokenExpiry: acc.credentials?.accessTokenExpiry ?? undefined,
    };

    const adapter = createAdapter(acc.broker as BrokerId, { brokerAccountId, credentials: creds });
    this.cache.set(brokerAccountId, adapter);
    this.log.info({ brokerAccountId, broker: acc.broker }, 'adapter created');
    return adapter;
  }

  evict(brokerAccountId: string): void {
    this.cache.delete(brokerAccountId);
  }
}
