import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { correlationIdMiddleware } from './common/middleware/correlationId';
import { errorHandler } from './common/middleware/errorHandler';

// Routes
import healthRouter from './routes/health/health.routes';
import authRouter from './modules/auth/auth.routes';
import doctorsRouter from './modules/doctors/doctors.routes';
import availabilityRouter from './modules/availability/availability.routes';
import consultationsRouter from './modules/consultations/consultations.routes';
import prescriptionsRouter from './modules/prescriptions/prescriptions.routes';
import paymentRoutes from './modules/payments/payments.routes';

export function createApp(): express.Application {
  const app = express();

  // ============================================================
  // Trust proxy (needed for correct IP in rate limiting)
  // ============================================================
  app.set('trust proxy', 1);

  // ============================================================
  // Raw body capture for webhook HMAC verification
  // ============================================================
  app.use(
    express.json({
      limit: env.BODY_LIMIT,
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  // ============================================================
  // Security headers
  // ============================================================
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // For Swagger UI
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );

  // ============================================================
  // CORS allowlisting
  // ============================================================
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: Origin ${origin} not allowed`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Correlation-Id',
        'Idempotency-Key',
        'X-Razorpay-Signature',
        'X-Webhook-Signature',
      ],
      exposedHeaders: ['X-Correlation-Id', 'Idempotency-Replay'],
    }),
  );

  // ============================================================
  // Correlation ID (before logging so it's in all log lines)
  // ============================================================
  app.use(correlationIdMiddleware);

  // ============================================================
  // Structured request logging
  // ============================================================
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).correlationId,
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          // Never log Authorization or Cookie headers
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || (res.statusCode ?? 0) >= 500) return 'error';
        if ((res.statusCode ?? 0) >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // ============================================================
  // Global rate limiting
  // ============================================================
  const globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    },
    skip: (req) => req.path.startsWith('/health'), // Don't rate-limit health checks
  });
  app.use(globalLimiter);

  // Auth-specific stricter rate limiting
  const authLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts. Please try again later.',
      },
    },
  });
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
  app.use('/api/v1/auth/forgot-password', authLimiter);

  // ============================================================
  // Health endpoints (no auth, no rate limit)
  // ============================================================
  app.use('/health', healthRouter);

  // ============================================================
  // Metrics endpoint (restricted — requires token in production)
  // ============================================================
  app.get('/metrics', (req: Request, res: Response) => {
    // In production, this would require METRICS_TOKEN authentication
    if (env.NODE_ENV === 'production') {
      const token = req.headers['x-metrics-token'];
      if (token !== env.METRICS_TOKEN) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Metrics token required' } });
        return;
      }
    }
    // Basic operational metrics
    res.status(200).json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // ============================================================
  // Swagger UI
  // ============================================================
  if (env.NODE_ENV !== 'production') {
    setupSwagger(app).catch((err) => logger.warn({ err }, 'Failed to setup Swagger'));
  }

  // ============================================================
  // API Routes
  // ============================================================
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/doctors', doctorsRouter);
  app.use('/api/v1/doctors/me/availability', availabilityRouter);
  app.use('/api/v1/consultations', consultationsRouter);
  app.use('/api/v1/prescriptions', prescriptionsRouter);
  app.use('/api/v1', paymentRoutes);

  // ============================================================
  // 404 handler
  // ============================================================
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
        requestId: req.correlationId,
      },
    });
  });

  // ============================================================
  // Centralized error handler (must be last)
  // ============================================================
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    errorHandler(err, req, res, next);
  });

  return app;
}

async function setupSwagger(app: express.Application): Promise<void> {
  try {
    const swaggerUi = await import('swagger-ui-express');
    const fs = await import('fs');
    const path = await import('path');

    const specPath = path.join(process.cwd(), 'docs', 'openapi.json');
    if (fs.existsSync(specPath)) {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Record<string, unknown>;
      app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));
      logger.info('Swagger UI available at /api/docs');
    }
  } catch {
    // Swagger setup failure is non-fatal
  }
}
