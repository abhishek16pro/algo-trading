/**
 * Dev seed: instruments + a demo user + a sample strategy.
 *
 * Run: pnpm seed
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  connectMongo,
  InstrumentModel,
  UserModel,
  StrategyModel,
  BrokerAccountModel,
  ensureTimeSeries,
} from '../packages/db/src/index.js';
import { generateMockInstruments } from '../packages/broker-adapters/src/mock/mock-instruments.js';
import { createLogger, loadConfig } from '../packages/utils/src/index.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger({ service: 'seed', level: 'info' });

  await connectMongo(cfg.MONGO_URI, log);
  await ensureTimeSeries().catch(() => undefined);

  // 1. Instruments
  const insCount = await InstrumentModel.countDocuments();
  if (insCount > 0) {
    log.info({ count: insCount }, 'instruments already seeded');
  } else {
    const mocks = generateMockInstruments();
    await InstrumentModel.insertMany(mocks, { ordered: false }).catch(() => undefined);
    log.info({ count: mocks.length }, 'instruments seeded');
  }

  // 2. Demo user
  const email = 'demo@algotrade.local';
  let user = await UserModel.findOne({ email });
  if (!user) {
    user = await UserModel.create({
      email,
      passwordHash: await bcrypt.hash('demo1234', 12),
      name: 'Demo User',
    });
    log.info({ email }, 'demo user created (password: demo1234)');
  }

  // 3. Mock broker account
  let broker = await BrokerAccountModel.findOne({ userId: user._id, broker: 'mock' });
  if (!broker) {
    broker = await BrokerAccountModel.create({
      userId: user._id,
      broker: 'mock',
      label: 'Dev mock',
      credentials: {},
      isActive: true,
      isPrimary: true,
    });
    log.info('mock broker account created');
  }

  // 4. Sample strategy
  const exists = await StrategyModel.findOne({ userId: user._id, name: 'Demo strangle' });
  if (!exists) {
    await StrategyModel.create({
      userId: user._id,
      name: 'Demo strangle',
      description: 'Sell BANKNIFTY weekly OTM strangle at 09:20',
      type: 'options-strangle',
      mode: 'stopped',
      underlying: 'BANKNIFTY',
      segment: 'options',
      brokerAccountId: broker._id,
      entry: {
        triggerType: 'time',
        time: '09:20',
        legs: [
          { legId: 'ce', action: 'SELL', optionType: 'CE', strikeSelection: 'OTM', strikeOffset: 2, lots: 1, expiry: 'current-week' },
          { legId: 'pe', action: 'SELL', optionType: 'PE', strikeSelection: 'OTM', strikeOffset: 2, lots: 1, expiry: 'current-week' },
        ],
      },
      exit: {
        stopLoss: { type: 'percent', value: 30 },
        timeExit: '15:15',
        reEntry: { enabled: false, maxAttempts: 0 },
      },
      risk: {
        capitalDeployed: 200_000,
        maxLossPerDay: 5_000,
        maxLossPerTrade: 2_000,
        maxPositions: 2,
        lotMultiplier: 1,
      },
      schedule: {
        activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        startTime: '09:15',
        endTime: '15:30',
      },
    });
    log.info('demo strategy created');
  }

  await mongoose.disconnect();
  log.info('seed done');
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
