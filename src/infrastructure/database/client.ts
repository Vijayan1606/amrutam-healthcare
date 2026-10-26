import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

// Singleton Prisma client with query logging in development
const createPrismaClient = () => {
  const client = new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],
  });

  if (process.env['NODE_ENV'] === 'development') {
    // Log slow queries (>100ms) in development
    client.$on('query', (e) => {
      if (e.duration > 100) {
        logger.warn({ duration: e.duration, query: e.query }, 'Slow database query');
      }
    });
  }

  client.$on('error', (e) => {
    logger.error({ target: e.target, message: e.message }, 'Prisma client error');
  });

  return client;
};

// Global declaration for development hot-reload singleton
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  process.env['NODE_ENV'] === 'development'
    ? (global.__prisma ?? (global.__prisma = createPrismaClient()))
    : createPrismaClient();

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return false;
  }
}
