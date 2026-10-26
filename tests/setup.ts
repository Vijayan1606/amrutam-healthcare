// Test environment setup — must run before any tests
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load test environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.test') });

// Ensure test database is used
if (!process.env['DATABASE_URL'] && process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
}

// Suppress Pino logging noise in tests unless DEBUG=true
if (!process.env['DEBUG']) {
  process.env['LOG_LEVEL'] = 'silent';
}

// Required env values for tests (override with safe test values)
process.env['JWT_ACCESS_SECRET'] = process.env['JWT_ACCESS_SECRET'] ?? 'test-access-secret-min-32-chars-long!!';
process.env['JWT_REFRESH_SECRET'] = process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret-min-32-chars-long!';
process.env['ENCRYPTION_KEY'] = process.env['ENCRYPTION_KEY'] ?? 'test-encryption-key-32-chars-lng!';
process.env['METRICS_TOKEN'] = process.env['METRICS_TOKEN'] ?? 'test-metrics-token-16ch';
process.env['NODE_ENV'] = 'test';
process.env['PAYMENT_PROVIDER'] = 'dev';
process.env['EMAIL_PROVIDER'] = 'console';
process.env['CORS_ALLOWED_ORIGINS'] = 'http://localhost:3000';
process.env['SLOT_EXPIRY_MINUTES'] = '30';
process.env['SLOT_EXPIRY_JOB_INTERVAL_MS'] = '300000';
process.env['RATE_LIMIT_WINDOW_MS'] = '900000';
process.env['RATE_LIMIT_MAX_REQUESTS'] = '1000';
process.env['AUTH_RATE_LIMIT_MAX'] = '100';
process.env['BODY_LIMIT'] = '1mb';
process.env['RESET_TOKEN_EXPIRES_MINUTES'] = '60';
