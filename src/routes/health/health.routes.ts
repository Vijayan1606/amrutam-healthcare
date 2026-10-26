import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../../infrastructure/database/client';

const router = Router();

// GET /health/live — liveness: is the process running?
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /health/ready — readiness: are dependencies reachable?
router.get('/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await checkDatabaseHealth();

  if (!dbHealthy) {
    res.status(503).json({
      status: 'unavailable',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'unhealthy',
      },
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      database: 'healthy',
    },
  });
});

export default router;
