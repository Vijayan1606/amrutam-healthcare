import { ConsultationStatus, AuditOutcome, UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
  ConflictError,
} from '../../common/errors/AppError';
import { writeAuditLog, AuditActions } from '../audit/audit.service';
import type { CreatePrescriptionInput, PrescriptionQueryInput } from './prescriptions.schemas';
import type { JwtPayload } from '../../common/middleware/auth';

const PRESCRIPTION_ALLOWED_CONSULTATION_STATUSES = [
  ConsultationStatus.CONFIRMED,
  ConsultationStatus.COMPLETED,
];

// ============================================================
// Create prescription (doctor only, for assigned consultation)
// ============================================================

export async function createPrescription(
  actor: JwtPayload,
  consultationId: string,
  input: CreatePrescriptionInput,
  meta: { correlationId?: string },
) {
  if (actor.role !== UserRole.DOCTOR) {
    throw new ForbiddenError('Only doctors can create prescriptions');
  }

  // Load consultation and verify doctor ownership
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      doctor: { select: { id: true, userId: true } },
      prescription: { select: { id: true } },
    },
  });

  if (!consultation) throw new NotFoundError('Consultation');

  // Doctor must be assigned to this consultation
  if (consultation.doctor.userId !== actor.sub) {
    throw new ForbiddenError('You are not the assigned doctor for this consultation');
  }

  // Consultation must be in a state that allows prescriptions
  if (!PRESCRIPTION_ALLOWED_CONSULTATION_STATUSES.includes(consultation.status)) {
    throw new AppError(
      `Cannot create prescription for a consultation in ${consultation.status} state. ` +
        `Allowed states: ${PRESCRIPTION_ALLOWED_CONSULTATION_STATUSES.join(', ')}`,
      422,
      'INVALID_CONSULTATION_STATE',
    );
  }

  // Prevent duplicate prescription for same consultation
  if (consultation.prescription) {
    throw new ConflictError(
      'A prescription already exists for this consultation',
      'PRESCRIPTION_EXISTS',
    );
  }

  const prescription = await prisma.$transaction(async (tx) => {
    const created = await tx.prescription.create({
      data: {
        consultationId,
        patientId: consultation.patientId,
        doctorId: consultation.doctor.id,
        diagnosis: input.diagnosis,
        notes: input.notes ?? null,
        medications: {
          create: input.medications.map((m) => ({
            name: m.name,
            dosage: m.dosage,
            frequency: m.frequency,
            durationDays: m.durationDays ?? null,
            instructions: m.instructions ?? null,
          })),
        },
      },
      include: { medications: true },
    });

    await writeAuditLog(
      {
        actorUserId: actor.sub,
        action: AuditActions.PRESCRIPTION_CREATED,
        resourceType: 'Prescription',
        resourceId: created.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        // Never log clinical content in audit metadata
        metadata: {
          consultationId,
          medicationCount: input.medications.length,
        },
      },
      tx,
    );

    return created;
  });

  return prescription;
}

// ============================================================
// Get prescription (patient/doctor/admin with ownership check)
// ============================================================

export async function getPrescriptionById(actor: JwtPayload, prescriptionId: string) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      medications: true,
      doctor: {
        select: {
          specialization: true,
          user: { select: { profile: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });

  if (!prescription) throw new NotFoundError('Prescription');

  // Ownership: patient can view own, doctor can view if assigned, admin cannot access clinical data by default
  const isPatient = actor.role === UserRole.PATIENT && prescription.patientId === actor.sub;
  const isDoctor = actor.role === UserRole.DOCTOR && prescription.doctor.user.profile !== null;

  // Doctor must be the one who issued it
  const isPrescribingDoctor =
    actor.role === UserRole.DOCTOR && prescription.doctorId !== null;

  if (actor.role === UserRole.ADMIN) {
    // Admins do not automatically get clinical content — documented assumption
    throw new ForbiddenError(
      'Administrators do not have default access to clinical prescription content',
    );
  }

  // Check patient is the right patient
  if (actor.role === UserRole.PATIENT && !isPatient) {
    throw new ForbiddenError('Access denied to this prescription');
  }

  // Check doctor is the prescribing doctor
  if (actor.role === UserRole.DOCTOR) {
    const doctorRecord = await prisma.doctor.findUnique({ where: { userId: actor.sub } });
    if (!doctorRecord || prescription.doctorId !== doctorRecord.id) {
      throw new ForbiddenError('You are not authorized to view this prescription');
    }
  }

  return prescription;
}

// ============================================================
// List prescriptions for the current patient
// ============================================================

export async function listMyPrescriptions(actor: JwtPayload, query: PrescriptionQueryInput) {
  if (actor.role !== UserRole.PATIENT) {
    throw new ForbiddenError('This endpoint is for patients only');
  }

  const [prescriptions, total] = await Promise.all([
    prisma.prescription.findMany({
      where: { patientId: actor.sub },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { issuedAt: 'desc' },
      include: {
        medications: true,
        doctor: {
          select: {
            specialization: true,
            user: { select: { profile: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    }),
    prisma.prescription.count({ where: { patientId: actor.sub } }),
  ]);

  return {
    data: prescriptions,
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
// Doctor: list prescriptions they issued
// ============================================================

export async function listDoctorPrescriptions(actor: JwtPayload, query: PrescriptionQueryInput) {
  if (actor.role !== UserRole.DOCTOR) {
    throw new ForbiddenError('This endpoint is for doctors only');
  }

  const doctorRecord = await prisma.doctor.findUnique({
    where: { userId: actor.sub },
    select: { id: true },
  });
  if (!doctorRecord) throw new NotFoundError('Doctor profile');

  const [prescriptions, total] = await Promise.all([
    prisma.prescription.findMany({
      where: {
        doctorId: doctorRecord.id,
        ...(query.patientId && { patientId: query.patientId }),
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { issuedAt: 'desc' },
      include: { medications: true },
    }),
    prisma.prescription.count({
      where: {
        doctorId: doctorRecord.id,
        ...(query.patientId && { patientId: query.patientId }),
      },
    }),
  ]);

  return {
    data: prescriptions,
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
