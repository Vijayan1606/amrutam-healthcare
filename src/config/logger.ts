import pino from 'pino';

// Sensitive fields to redact from all log output
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.resetToken',
  'req.body.idempotencyKey',
  'req.body.cardNumber',
  'req.body.cvv',
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'tokenHash',
  'resetToken',
  '*.secret',
  '*.apiKey',
  '*.apiSecret',
];

const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: {
    service: 'amrutam-healthcare',
    env: process.env['NODE_ENV'] ?? 'development',
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export type Logger = typeof logger;
