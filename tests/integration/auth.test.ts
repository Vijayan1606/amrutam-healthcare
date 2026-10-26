import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/client';
import { UserRole, UserStatus } from '@prisma/client';
import argon2 from 'argon2';

const app = createApp();

const TEST_USER = {
  email: `test-${Date.now()}@amrutam.test`,
  password: 'TestPass@123!',
  firstName: 'Test',
  lastName: 'User',
  confirmPassword: 'TestPass@123!',
};

const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

afterAll(async () => {
  // Cleanup test users
  await prisma.user.deleteMany({
    where: { email: { contains: '@amrutam.test' } },
  });
  await prisma.$disconnect();
});

describe('Authentication Integration', () => {
  describe('POST /api/v1/auth/register', () => {
    it('registers a patient with valid data', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(TEST_USER);

      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe(TEST_USER.email);
      expect(res.body.data.role).toBe(UserRole.PATIENT);
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('prevents duplicate registration', async () => {
      const email = `dup-${Date.now()}@amrutam.test`;
      const user = { ...TEST_USER, email };

      await request(app).post('/api/v1/auth/register').send(user);
      const res = await request(app).post('/api/v1/auth/register').send(user);

      expect(res.status).toBe(409);
    });

    it('rejects weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...TEST_USER, email: `weak-${Date.now()}@amrutam.test`, password: 'weak', confirmPassword: 'weak' });

      expect(res.status).toBe(400);
    });

    it('rejects invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...TEST_USER, email: 'not-an-email' });

      expect(res.status).toBe(400);
    });

    it('SECURITY: cannot register as ADMIN role', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...TEST_USER, email: `nonadmin-${Date.now()}@amrutam.test`, role: 'ADMIN' });

      // Either 201 (registered as PATIENT, ignoring role) or 400
      if (res.status === 201) {
        expect(res.body.data.role).toBe(UserRole.PATIENT);
      } else {
        expect(res.status).toBe(400);
      }
    });
  });

  describe('POST /api/v1/auth/login', () => {
    const loginEmail = `login-${Date.now()}@amrutam.test`;
    const loginPassword = 'LoginPass@456!';

    beforeAll(async () => {
      await request(app).post('/api/v1/auth/register').send({
        email: loginEmail,
        password: loginPassword,
        confirmPassword: loginPassword,
        firstName: 'Login',
        lastName: 'Test',
      });
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: loginEmail, password: loginPassword });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('rejects wrong password with generic message', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: loginEmail, password: 'WrongPass@123' });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
      // Generic message — must not say "wrong password"
      expect(res.body.error.message).not.toContain('password');
    });

    it('returns 401 for non-existent account (same message as wrong password)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@amrutam.test', password: 'SomePass@1' });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });
  });

  describe('Refresh token rotation', () => {
    let refreshToken: string;
    let loginEmail: string;
    const password = 'RefreshPass@789!';

    beforeAll(async () => {
      loginEmail = `refresh-${Date.now()}@amrutam.test`;
      await request(app).post('/api/v1/auth/register').send({
        email: loginEmail, password, confirmPassword: password,
        firstName: 'Refresh', lastName: 'Test',
      });
      const loginRes = await request(app).post('/api/v1/auth/login').send({ email: loginEmail, password });
      refreshToken = loginRes.body.data.refreshToken as string;
    });

    it('issues new tokens on valid refresh', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).not.toBe(refreshToken); // Must be new token
    });

    it('SECURITY: rejects replayed refresh token', async () => {
      const loginRes = await request(app).post('/api/v1/auth/login').send({ email: loginEmail, password });
      const originalToken = loginRes.body.data.refreshToken as string;

      // Use token once
      const firstRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: originalToken });
      expect(firstRefresh.status).toBe(200);

      // Replay the original token — must be rejected (family revocation)
      const replayRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: originalToken });
      expect(replayRes.status).toBe(401);

      // New token from first refresh must also be invalidated (family revocation)
      const newToken = firstRefresh.body.data.refreshToken as string;
      const thirdRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: newToken });
      expect(thirdRefresh.status).toBe(401);
    });

    it('rejects invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'completely-invalid-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns user data with valid token', async () => {
      const email = `me-${Date.now()}@amrutam.test`;
      const password = 'MePass@123!';

      await request(app).post('/api/v1/auth/register').send({
        email, password, confirmPassword: password, firstName: 'Me', lastName: 'Test',
      });
      const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password });
      const token = loginRes.body.data.accessToken as string;

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(email);
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('rejects unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Password reset', () => {
    it('forgot-password returns success regardless of whether email exists', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@amrutam.test' });

      expect(res.status).toBe(200);
      // Generic message — must not reveal account existence
      expect(res.body.data.message).toContain('If that email');
    });
  });

  describe('Health endpoints', () => {
    it('GET /health/live returns 200', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
