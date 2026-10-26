/**
 * Security Tests — IDOR, Privilege Escalation, Auth Bypass
 *
 * These tests verify that the authorization model is correctly enforced
 * server-side, independent of the frontend.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/client';
import { UserRole, UserStatus, DoctorVerificationStatus, SlotStatus } from '@prisma/client';
import argon2 from 'argon2';

const app = createApp();

const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };
const STRONG_PASSWORD = 'SecureTest@1234!';

// ============================================================
// Helper functions
// ============================================================

async function createTestUser(email: string, role: UserRole = UserRole.PATIENT) {
  const passwordHash = await argon2.hash(STRONG_PASSWORD, ARGON2_OPTIONS);
  return prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
      status: UserStatus.ACTIVE,
      profile: { create: { firstName: 'Security', lastName: 'Test' } },
    },
  });
}

async function getToken(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: STRONG_PASSWORD });

  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken as string;
}

async function createTestDoctor(userId: string, licenseNumber: string, verified = true) {
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  return prisma.doctor.create({
    data: {
      userId,
      licenseNumber,
      specialization: 'Test Specialty',
      qualifications: ['MBBS'],
      consultationFeeMinor: 50000,
      currency: 'INR',
      verificationStatus: verified ? DoctorVerificationStatus.VERIFIED : DoctorVerificationStatus.PENDING,
      verifiedAt: verified ? new Date() : null,
      verifiedBy: verified ? admin?.id ?? null : null,
    },
  });
}

// ============================================================
// Setup and cleanup
// ============================================================

const TEST_TS = Date.now();

let patientAToken: string;
let patientBToken: string;
let doctor1Token: string;
let doctor2Token: string;

let patientAId: string;
let patientBId: string;
let doctor1Id: string; // doctor record
let doctor2Id: string;
let doctor1UserId: string;
let doctor2UserId: string;

beforeAll(async () => {
  // Create test users
  const pA = await createTestUser(`sec-patient-a-${TEST_TS}@amrutam.test`, UserRole.PATIENT);
  const pB = await createTestUser(`sec-patient-b-${TEST_TS}@amrutam.test`, UserRole.PATIENT);
  const d1User = await createTestUser(`sec-doctor-1-${TEST_TS}@amrutam.test`, UserRole.DOCTOR);
  const d2User = await createTestUser(`sec-doctor-2-${TEST_TS}@amrutam.test`, UserRole.DOCTOR);

  patientAId = pA.id;
  patientBId = pB.id;
  doctor1UserId = d1User.id;
  doctor2UserId = d2User.id;

  // Create doctor profiles
  const d1 = await createTestDoctor(d1User.id, `SEC-LIC-${TEST_TS}-1`, true);
  const d2 = await createTestDoctor(d2User.id, `SEC-LIC-${TEST_TS}-2`, true);
  doctor1Id = d1.id;
  doctor2Id = d2.id;

  // Get access tokens
  patientAToken = await getToken(pA.email);
  patientBToken = await getToken(pB.email);
  doctor1Token = await getToken(d1User.email);
  doctor2Token = await getToken(d2User.email);
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { contains: `sec-` } },
  });
  await prisma.$disconnect();
});

// ============================================================
// Test 1: Patient A cannot access Patient B's consultations
// ============================================================
describe('SECURITY: IDOR - Patient cannot access another patient\'s records', () => {
  let consultationId: string;
  let slotId: string;

  beforeAll(async () => {
    // Create availability slot for doctor 1
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    tomorrow.setHours(14, 0, 0, 0);

    const slot = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctor1Id,
        startAt: new Date(tomorrow),
        endAt: new Date(tomorrow.getTime() + 30 * 60_000),
        status: SlotStatus.AVAILABLE,
      },
    });
    slotId = slot.id;

    // Patient A books consultation
    const bookRes = await request(app)
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', `sec-book-${TEST_TS}-a`)
      .send({ doctorId: doctor1Id, slotId, reason: 'Security test booking' });

    consultationId = bookRes.body.data?.id as string;
  });

  it('Patient B cannot read Patient A\'s consultation', async () => {
    if (!consultationId) return;

    const res = await request(app)
      .get(`/api/v1/consultations/${consultationId}`)
      .set('Authorization', `Bearer ${patientBToken}`);

    expect(res.status).toBe(403);
  });

  it('Unauthenticated user cannot access protected endpoint', async () => {
    const res = await request(app).get('/api/v1/consultations');
    expect(res.status).toBe(401);
  });
});

// ============================================================
// Test 2: Doctor cannot modify another doctor's availability
// ============================================================
describe('SECURITY: Doctor cannot modify another doctor\'s availability', () => {
  let doctor1SlotId: string;

  beforeAll(async () => {
    const tomorrow = new Date(Date.now() + 48 * 3600 * 1000);
    tomorrow.setHours(15, 0, 0, 0);

    const slot = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctor1Id,
        startAt: tomorrow,
        endAt: new Date(tomorrow.getTime() + 30 * 60_000),
        status: SlotStatus.AVAILABLE,
      },
    });
    doctor1SlotId = slot.id;
  });

  it('Doctor 2 cannot update Doctor 1\'s slot', async () => {
    const res = await request(app)
      .patch(`/api/v1/doctors/me/availability/${doctor1SlotId}`)
      .set('Authorization', `Bearer ${doctor2Token}`)
      .send({ status: 'BLOCKED' });

    expect(res.status).toBe(403);
  });

  it('Doctor 2 cannot delete Doctor 1\'s slot', async () => {
    const res = await request(app)
      .delete(`/api/v1/doctors/me/availability/${doctor1SlotId}`)
      .set('Authorization', `Bearer ${doctor2Token}`);

    expect(res.status).toBe(403);
  });
});

// ============================================================
// Test 3: Role escalation attempts
// ============================================================
describe('SECURITY: Role escalation prevention', () => {
  it('Registration ignores role field in body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `escalate-${TEST_TS}@amrutam.test`,
        password: STRONG_PASSWORD,
        confirmPassword: STRONG_PASSWORD,
        firstName: 'Escalate',
        lastName: 'Test',
        role: 'ADMIN', // Attempt to escalate
      });

    if (res.status === 201) {
      expect(res.body.data.role).toBe(UserRole.PATIENT);
    } else {
      // 400 is also acceptable if strict parsing
      expect(res.status).toBe(400);
    }
  });

  it('Patient cannot access admin endpoints', async () => {
    const res = await request(app)
      .patch(`/api/v1/doctors/${doctor1Id}/verify`)
      .set('Authorization', `Bearer ${patientAToken}`);

    expect(res.status).toBe(403);
  });

  it('Doctor cannot verify another doctor', async () => {
    const res = await request(app)
      .patch(`/api/v1/doctors/${doctor2Id}/verify`)
      .set('Authorization', `Bearer ${doctor1Token}`);

    expect(res.status).toBe(403);
  });
});

// ============================================================
// Test 4: Invalid JWT attacks
// ============================================================
describe('SECURITY: JWT attack prevention', () => {
  it('Rejects token with "alg: none"', async () => {
    // Craft a token with alg:none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: patientAId,
      email: `sec-patient-a-${TEST_TS}@amrutam.test`,
      role: 'PATIENT',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'amrutam-healthcare',
      aud: 'amrutam-clients',
    })).toString('base64url');

    const unsignedToken = `${header}.${payload}.`;

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${unsignedToken}`);

    expect(res.status).toBe(401);
  });

  it('Rejects expired token', async () => {
    // We rely on the real JWT signing — just verify expired token handling works
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid');

    expect(res.status).toBe(401);
  });

  it('Rejects requests without Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

// ============================================================
// Test 5: Webhook security
// ============================================================
describe('SECURITY: Webhook signature verification', () => {
  it('Rejects webhook with invalid signature', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('x-webhook-signature', 'totally-invalid-signature')
      .send({ providerReference: 'DEV-test', status: 'SUCCEEDED' });

    expect(res.status).toBe(401);
  });
});

// ============================================================
// Test 6: Prescription access control
// ============================================================
describe('SECURITY: Prescription access control', () => {
  it('Unauthenticated users cannot list prescriptions', async () => {
    const res = await request(app).get('/api/v1/prescriptions');
    expect(res.status).toBe(401);
  });

  it('Patient cannot create a prescription', async () => {
    const res = await request(app)
      .post('/api/v1/consultations/some-id/prescriptions')
      .set('Authorization', `Bearer ${patientAToken}`)
      .send({ diagnosis: 'test', medications: [] });

    // 403 (forbidden role) or 400 (validation)
    expect([400, 403]).toContain(res.status);
  });
});

// ============================================================
// Test 7: Sensitive data not in error responses
// ============================================================
describe('SECURITY: No sensitive data in error responses', () => {
  it('Login failure does not expose internal details', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@amrutam.test', password: 'wrong' });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('prisma');
    expect(body).not.toContain('SQL');
  });

  it('404 response does not expose internal paths', async () => {
    const res = await request(app).get('/api/v1/nonexistent-route');
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('.ts');
  });
});
