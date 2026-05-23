import pino, { type Logger, type LoggerOptions } from 'pino';

const REDACT_PATHS = [
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'credentials.*',
  '*.credentials.*',
  'accessToken',
  'refreshToken',
  '*.accessToken',
  '*.refreshToken',
  'apiKey',
  'apiSecret',
  '*.apiKey',
  '*.apiSecret',
  'totpSecret',
  '*.totpSecret',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

export type LoggerInit = {
  service: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  pretty?: boolean;
};

export function createLogger(init: LoggerInit): Logger {
  const opts: LoggerOptions = {
    level: init.level ?? 'info',
    base: { service: init.service, pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (init.pretty || process.env.NODE_ENV === 'development') {
    return pino({
      ...opts,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,service',
          messageFormat: '[{service}] {msg}',
        },
      },
    });
  }
  return pino(opts);
}

export type { Logger } from 'pino';
