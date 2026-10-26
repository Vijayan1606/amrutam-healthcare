import { PrismaClient, UserRole, UserStatus, DoctorVerificationStatus, SlotStatus } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Argon2id parameters
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

async function main() {
  console.log('🌱 Seeding development database...');

  // ============================================================
  // DEV CREDENTIALS — NEVER USE IN PRODUCTION
  // ============================================================
  const DEV_PASSWORD = 'Dev@12345!'; // Development-only password

  const adminPasswordHash = await argon2.hash(DEV_PASSWORD, ARGON2_OPTIONS);
  const doctorPasswordHash = await argon2.hash(DEV_PASSWORD, ARGON2_OPTIONS);
  const patientPasswordHash = await argon2.hash(DEV_PASSWORD, ARGON2_OPTIONS);

  // Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@amrutam.dev' },
    update: {},
    create: {
      email: 'admin@amrutam.dev',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: { create: { firstName: 'Admin', lastName: 'User' } },
    },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // Doctor 1 (verified)
  const doctor1User = await prisma.user.upsert({
    where: { email: 'dr.sharma@amrutam.dev' },
    update: {},
    create: {
      email: 'dr.sharma@amrutam.dev',
      passwordHash: doctorPasswordHash,
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: { create: { firstName: 'Priya', lastName: 'Sharma' } },
    },
  });

  const doctor1 = await prisma.doctor.upsert({
    where: { userId: doctor1User.id },
    update: {},
    create: {
      userId: doctor1User.id,
      licenseNumber: 'MH-2024-001',
      specialization: 'General Medicine',
      qualifications: ['MBBS', 'MD (General Medicine)'],
      biography: 'Experienced general physician with 10 years of practice.',
      consultationFeeMinor: 50000, // ₹500.00 in paisa
      currency: 'INR',
      verificationStatus: DoctorVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedBy: admin.id,
    },
  });
  console.log(`✅ Doctor 1 (verified): ${doctor1User.email} — Dr. ${doctor1.licenseNumber}`);

  // Doctor 2 (for authorization tests — separate doctor)
  const doctor2User = await prisma.user.upsert({
    where: { email: 'dr.patel@amrutam.dev' },
    update: {},
    create: {
      email: 'dr.patel@amrutam.dev',
      passwordHash: doctorPasswordHash,
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: { create: { firstName: 'Rahul', lastName: 'Patel' } },
    },
  });

  await prisma.doctor.upsert({
    where: { userId: doctor2User.id },
    update: {},
    create: {
      userId: doctor2User.id,
      licenseNumber: 'MH-2024-002',
      specialization: 'Dermatology',
      qualifications: ['MBBS', 'MD (Dermatology)', 'DNB'],
      biography: 'Specialist in skin conditions and cosmetic dermatology.',
      consultationFeeMinor: 75000, // ₹750.00 in paisa
      currency: 'INR',
      verificationStatus: DoctorVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedBy: admin.id,
    },
  });
  console.log(`✅ Doctor 2 (verified): ${doctor2User.email}`);

  // Patient
  const patient = await prisma.user.upsert({
    where: { email: 'patient@amrutam.dev' },
    update: {},
    create: {
      email: 'patient@amrutam.dev',
      passwordHash: patientPasswordHash,
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          firstName: 'Anjali',
          lastName: 'Singh',
          phone: '+919876543210',
          preferredTimezone: 'Asia/Kolkata',
        },
      },
    },
  });
  console.log(`✅ Patient: ${patient.email}`);

  // Patient 2 (for cross-patient auth tests)
  const patient2 = await prisma.user.upsert({
    where: { email: 'patient2@amrutam.dev' },
    update: {},
    create: {
      email: 'patient2@amrutam.dev',
      passwordHash: patientPasswordHash,
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: {
        create: { firstName: 'Rohan', lastName: 'Mehta' },
      },
    },
  });
  console.log(`✅ Patient 2: ${patient2.email}`);

  // Availability slots for Doctor 1 (future dates)
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(10, 0, 0, 0);

  const slots = [
    { startAt: new Date(tomorrow), endAt: new Date(tomorrow.getTime() + 30 * 60_000) },
    {
      startAt: new Date(tomorrow.getTime() + 60 * 60_000),
      endAt: new Date(tomorrow.getTime() + 90 * 60_000),
    },
    {
      startAt: new Date(tomorrow.getTime() + 120 * 60_000),
      endAt: new Date(tomorrow.getTime() + 150 * 60_000),
    },
  ];

  for (const slot of slots) {
    const existing = await prisma.availabilitySlot.findFirst({
      where: { doctorId: doctor1.id, startAt: slot.startAt },
    });
    if (!existing) {
      await prisma.availabilitySlot.create({
        data: {
          doctorId: doctor1.id,
          startAt: slot.startAt,
          endAt: slot.endAt,
          status: SlotStatus.AVAILABLE,
        },
      });
    }
  }
  console.log(`✅ Created ${slots.length} availability slots for Dr. Sharma`);

  console.log('\n🎉 Seed complete!');
  console.log('\n--- DEV CREDENTIALS (never use in production) ---');
  console.log(`Admin:    admin@amrutam.dev     / ${DEV_PASSWORD}`);
  console.log(`Doctor 1: dr.sharma@amrutam.dev / ${DEV_PASSWORD}`);
  console.log(`Doctor 2: dr.patel@amrutam.dev  / ${DEV_PASSWORD}`);
  console.log(`Patient:  patient@amrutam.dev   / ${DEV_PASSWORD}`);
  console.log(`Patient2: patient2@amrutam.dev  / ${DEV_PASSWORD}`);
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
