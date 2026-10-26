import { DoctorVerificationStatus, AuditOutcome } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import { NotFoundError, ForbiddenError, ConflictError, AppError } from '../../common/errors/AppError';
import { writeAuditLog, AuditActions } from '../audit/audit.service';
import type {
  CreateDoctorProfileInput,
  UpdateDoctorProfileInput,
  DoctorQueryInput,
} from './doctors.schemas';

// ============================================================
// Public doctor fields (safe for public doctor listing)
// ============================================================

const PUBLIC_DOCTOR_SELECT = {
  id: true,
  specialization: true,
  qualifications: true,
  biography: true,
  consultationFeeMinor: true,
  currency: true,
  verificationStatus: true,
  createdAt: true,
  user: {
    select: {
      profile: {
        select: { firstName: true, lastName: true },
      },
    },
  },
} as const;

// ============================================================
// Create doctor profile
// ============================================================

export async function createDoctorProfile(
  userId: string,
  input: CreateDoctorProfileInput,
  meta: { correlationId?: string },
) {
  // Prevent duplicate doctor profile
  const existing = await prisma.doctor.findUnique({ where: { userId } });
  if (existing) {
    throw new ConflictError('Doctor profile already exists for this user', 'CONFLICT');
  }

  const doctor = await prisma.$transaction(async (tx) => {
    const created = await tx.doctor.create({
      data: {
        userId,
        licenseNumber: input.licenseNumber,
        specialization: input.specialization,
        qualifications: input.qualifications,
        biography: input.biography ?? null,
        consultationFeeMinor: input.consultationFeeMinor,
        currency: input.currency,
        verificationStatus: DoctorVerificationStatus.PENDING,
      },
      select: { ...PUBLIC_DOCTOR_SELECT, licenseNumber: true },
    });

    await writeAuditLog(
      {
        actorUserId: userId,
        action: AuditActions.DOCTOR_PROFILE_CREATED,
        resourceType: 'Doctor',
        resourceId: created.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );

    return created;
  });

  return doctor;
}

// ============================================================
// Doctor discovery (public endpoint — no private data)
// ============================================================

export async function listDoctors(query: DoctorQueryInput) {
  const skip = (query.page - 1) * query.limit;

  const where = {
    verificationStatus: query.verifiedOnly
      ? DoctorVerificationStatus.VERIFIED
      : { in: [DoctorVerificationStatus.VERIFIED, DoctorVerificationStatus.PENDING] },
    ...(query.specialization && {
      specialization: { contains: query.specialization, mode: 'insensitive' as const },
    }),
    ...(query.search && {
      OR: [
        { specialization: { contains: query.search, mode: 'insensitive' as const } },
        { biography: { contains: query.search, mode: 'insensitive' as const } },
        {
          user: {
            profile: {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' as const } },
                { lastName: { contains: query.search, mode: 'insensitive' as const } },
              ],
            },
          },
        },
      ],
    }),
  };

  const [doctors, total] = await Promise.all([
    prisma.doctor.findMany({
      where,
      select: PUBLIC_DOCTOR_SELECT,
      skip,
      take: query.limit,
      orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.doctor.count({ where }),
  ]);

  return {
    data: doctors,
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
      hasNext: query.page * query.limit < total,
      hasPrev: query.page > 1,
    },
  };
}

// ============================================================
// Get single doctor (public)
// ============================================================

export async function getDoctorById(doctorId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: PUBLIC_DOCTOR_SELECT,
  });

  if (!doctor) {
    throw new NotFoundError('Doctor');
  }

  return doctor;
}

// ============================================================
// Get doctor's own profile (includes private fields)
// ============================================================

export async function getMyDoctorProfile(userId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    select: {
      ...PUBLIC_DOCTOR_SELECT,
      licenseNumber: true,
      verifiedAt: true,
      suspensionReason: true,
    },
  });

  if (!doctor) {
    throw new NotFoundError('Doctor profile');
  }

  return doctor;
}

// ============================================================
// Update doctor profile (self only, restricted fields)
// ============================================================

export async function updateMyDoctorProfile(
  userId: string,
  input: UpdateDoctorProfileInput,
) {
  const doctor = await prisma.doctor.findUnique({ where: { userId } });
  if (!doctor) {
    throw new NotFoundError('Doctor profile');
  }

  return prisma.doctor.update({
    where: { id: doctor.id },
    data: {
      ...(input.biography !== undefined && { biography: input.biography }),
      ...(input.qualifications && { qualifications: input.qualifications }),
      ...(input.consultationFeeMinor !== undefined && {
        consultationFeeMinor: input.consultationFeeMinor,
      }),
    },
    select: PUBLIC_DOCTOR_SELECT,
  });
}

// ============================================================
// Admin: Verify doctor
// ============================================================

export async function verifyDoctor(
  adminUserId: string,
  doctorId: string,
  meta: { correlationId?: string },
) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new NotFoundError('Doctor');

  if (doctor.verificationStatus === DoctorVerificationStatus.VERIFIED) {
    throw new ConflictError('Doctor is already verified', 'CONFLICT');
  }

  await prisma.$transaction(async (tx) => {
    await tx.doctor.update({
      where: { id: doctorId },
      data: {
        verificationStatus: DoctorVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedBy: adminUserId,
        suspensionReason: null,
      },
    });

    await writeAuditLog(
      {
        actorUserId: adminUserId,
        action: AuditActions.DOCTOR_VERIFIED,
        resourceType: 'Doctor',
        resourceId: doctorId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });
}

// ============================================================
// Admin: Suspend doctor
// ============================================================

export async function suspendDoctor(
  adminUserId: string,
  doctorId: string,
  reason: string,
  meta: { correlationId?: string },
) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new NotFoundError('Doctor');

  await prisma.$transaction(async (tx) => {
    await tx.doctor.update({
      where: { id: doctorId },
      data: {
        verificationStatus: DoctorVerificationStatus.SUSPENDED,
        suspensionReason: reason,
      },
    });

    await writeAuditLog(
      {
        actorUserId: adminUserId,
        action: AuditActions.DOCTOR_SUSPENDED,
        resourceType: 'Doctor',
        resourceId: doctorId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: { reason },
      },
      tx,
    );
  });
}

// ============================================================
// Get doctor entity (internal — for booking validation)
// ============================================================

export async function getDoctorForBooking(doctorId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      userId: true,
      verificationStatus: true,
      consultationFeeMinor: true,
      currency: true,
    },
  });

  if (!doctor) throw new NotFoundError('Doctor');

  if (doctor.verificationStatus !== DoctorVerificationStatus.VERIFIED) {
    throw new AppError(
      'This doctor is not currently accepting appointments',
      422,
      doctor.verificationStatus === DoctorVerificationStatus.SUSPENDED
        ? 'DOCTOR_SUSPENDED'
        : 'DOCTOR_NOT_VERIFIED',
    );
  }

  return doctor;
}
