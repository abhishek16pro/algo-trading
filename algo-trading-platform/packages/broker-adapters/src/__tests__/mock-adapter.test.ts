import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockBrokerAdapter } from '../mock/MockBrokerAdapter.js';
import type { Tick, OrderStatusEvent } from '@algo/shared-types';

describe('MockBrokerAdapter — contract', () => {
  let adapter: MockBrokerAdapter;

  beforeEach(async () => {
    adapter = new MockBrokerAdapter();
    await adapter.fetchInstruments();
  });

  afterEach(async () => {
    await adapter.disconnectWS();
  });

  it('logs in and returns a token', async () => {
    const { accessToken, expiry } = await adapter.login({});
    expect(accessToken).toMatch(/^mock-access-/);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it('publishes ticks for subscribed tokens', async () => {
    await adapter.connectWS();
    const seen: Tick[] = [];
    adapter.on('tick', (t) => seen.push(t));
    await adapter.subscribe(['IDX:NIFTY'], 'ltp');
    await new Promise((r) => setTimeout(r, 1200));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.instrumentToken).toBe('IDX:NIFTY');
    expect(seen[0]!.ltp).toBeGreaterThan(0);
  });

  it('fills a MARKET order instantly and emits an order event', async () => {
    await adapter.connectWS();
    await adapter.subscribe(['IDX:NIFTY'], 'ltp');
    await new Promise((r) => setTimeout(r, 100));

    const events: OrderStatusEvent[] = [];
    adapter.on('order', (e) => events.push(e));

    const ins = (await adapter.fetchInstruments()).find((i) => i.tradingsymbol === 'NIFTY')!;
    const { brokerOrderId } = await adapter.placeOrder({
      tradingsymbol: ins.tradingsymbol,
      exchange: ins.exchange,
      side: 'BUY',
      quantity: 25,
      orderType: 'MARKET',
      product: 'MIS',
      validity: 'DAY',
    });
    expect(brokerOrderId).toMatch(/^MOCK-/);
    const order = await adapter.getOrder(brokerOrderId);
    expect(order.status).toBe('COMPLETE');
    expect(order.filledQty).toBe(25);
    expect(events.find((e) => e.brokerOrderId === brokerOrderId)?.status).toBe('COMPLETE');
  });

  it('rejects modify on a completed order', async () => {
    const ins = (await adapter.fetchInstruments())[0]!;
    const { brokerOrderId } = await adapter.placeOrder({
      tradingsymbol: ins.tradingsymbol,
      exchange: ins.exchange,
      side: 'BUY',
      quantity: 1,
      orderType: 'MARKET',
      product: 'MIS',
      validity: 'DAY',
    });
    await expect(adapter.modifyOrder(brokerOrderId, { price: 1 })).rejects.toThrow();
  });

  it('updates positions after fills', async () => {
    const ins = (await adapter.fetchInstruments()).find((i) => i.instrumentType === 'CE')!;
    await adapter.placeOrder({
      tradingsymbol: ins.tradingsymbol,
      exchange: ins.exchange,
      side: 'SELL',
      quantity: ins.lotSize,
      orderType: 'MARKET',
      product: 'NRML',
      validity: 'DAY',
    });
    const positions = await adapter.getPositions();
    const p = positions.find((pp) => pp.tradingsymbol === ins.tradingsymbol);
    expect(p).toBeDefined();
    expect(p!.netQty).toBe(-ins.lotSize);
  });

  it('returns historical candles with monotonic time', async () => {
    const ins = (await adapter.fetchInstruments())[0]!;
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60_000);
    const candles = await adapter.getHistorical(ins.instrumentToken, from, to, '5m');
    expect(candles.length).toBeGreaterThan(0);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.t.getTime()).toBeGreaterThan(candles[i - 1]!.t.getTime());
    }
  });

  it('cancels an open LIMIT order', async () => {
    const ins = (await adapter.fetchInstruments())[0]!;
    const { brokerOrderId } = await adapter.placeOrder({
      tradingsymbol: ins.tradingsymbol,
      exchange: ins.exchange,
      side: 'BUY',
      quantity: 1,
      orderType: 'LIMIT',
      price: 0.01,
      product: 'MIS',
      validity: 'DAY',
    });
    await adapter.cancelOrder(brokerOrderId);
    const o = await adapter.getOrder(brokerOrderId);
    expect(o.status).toBe('CANCELLED');
  });
});
