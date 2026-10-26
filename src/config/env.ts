import { z } from 'zod';

// Parse and validate all environment variables at startup.
// The application will fail fast if required config is missing.

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('amrutam-healthcare'),
  JWT_AUDIENCE: z.string().default('amrutam-clients'),

  // Password reset
  RESET_TOKEN_EXPIRES_MINUTES: z.coerce.number().int().min(5).default(60),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),

  // CORS
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 chars'),

  // Payment
  PAYMENT_PROVIDER: z.enum(['dev', 'razorpay', 'stripe']).default('dev'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@amrutam.health'),

  // Slot expiry
  SLOT_EXPIRY_MINUTES: z.coerce.number().int().min(5).default(30),
  SLOT_EXPIRY_JOB_INTERVAL_MS: z.coerce.number().int().default(300000),

  // Observability
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  METRICS_TOKEN: z.string().min(16, 'METRICS_TOKEN must be at least 16 chars'),

  // Security
  BODY_LIMIT: z.string().default('1mb'),
});

function loadEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([field, msgs]) => `  ${field}: ${msgs?.join(', ')}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }
  return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
