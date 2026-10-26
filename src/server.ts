import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { disconnectDatabase } from './infrastructure/database/client';
import { expireUnpaidConsultations } from './modules/consultations/consultations.service';

const app = createApp();
const server = http.createServer(app);

// ============================================================
// Slot expiry background job
// ============================================================
let expiryJobHandle: NodeJS.Timeout | null = null;

function startExpiryJob(): void {
  expiryJobHandle = setInterval(async () => {
    try {
      const count = await expireUnpaidConsultations();
      if (count > 0) {
        logger.info({ count }, 'Expired unpaid consultations, slots released');
      }
    } catch (err) {
      logger.error({ err }, 'Slot expiry job failed');
    }
  }, env.SLOT_EXPIRY_JOB_INTERVAL_MS);

  logger.info(
    { intervalMs: env.SLOT_EXPIRY_JOB_INTERVAL_MS },
    'Slot expiry background job started',
  );
}

// ============================================================
// Graceful shutdown
// ============================================================
let shutdownInProgress = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info({ signal }, 'Graceful shutdown initiated');

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Stop background jobs
    if (expiryJobHandle) {
      clearInterval(expiryJobHandle);
      logger.info('Expiry job stopped');
    }

    // Disconnect database
    await disconnectDatabase();

    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.fatal('Forced shutdown after timeout');
    process.exit(1);
  }, 30_000);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

// Catch unhandled exceptions and rejections — log them but don't crash silently
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  void gracefulShutdown('unhandledRejection');
});

// ============================================================
// Start server
// ============================================================
server.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      pid: process.pid,
    },
    `Amrutam Healthcare API started`,
  );

  startExpiryJob();
});

export { server };
