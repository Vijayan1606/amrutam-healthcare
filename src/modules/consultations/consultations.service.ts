import { ConsultationStatus, SlotStatus, AuditOutcome, UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import {
  NotFoundError,
  ForbiddenError,
  BookingConflictError,
  AppError,
} from '../../common/errors/AppError';
import { writeAuditLog, AuditActions } from '../audit/audit.service';
import { getDoctorForBooking } from '../doctors/doctors.service';
import { env } from '../../config/env';
import type {
  BookConsultationInput,
  CancelConsultationInput,
  ConsultationQueryInput,
} from './consultations.schemas';
import type { JwtPayload } from '../../common/middleware/auth';

// ============================================================
// Valid status transitions (centralized)
// ============================================================

const VALID_TRANSITIONS: Record<ConsultationStatus, ConsultationStatus[]> = {
  PENDING_PAYMENT: [ConsultationStatus.CONFIRMED, ConsultationStatus.CANCELLED],
  CONFIRMED: [ConsultationStatus.CANCELLED, ConsultationStatus.COMPLETED, ConsultationStatus.NO_SHOW],
  CANCELLED: [],   // Terminal state
  COMPLETED: [],   // Terminal state
  NO_SHOW: [],     // Terminal state
};

// Cancellation allowed up to CANCELLATION_HOURS_BEFORE hours before appointment
const CANCELLATION_HOURS_BEFORE = 2;

function validateTransition(from: ConsultationStatus, to: ConsultationStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new AppError(
      `Cannot transition consultation from ${from} to ${to}`,
      422,
      'INVALID_STATUS_TRANSITION',
    );
  }
}

// ============================================================
// Book a consultation (CRITICAL — transactional, race-safe)
// ============================================================

export async function bookConsultation(
  patient: JwtPayload,
  input: BookConsultationInput,
  meta: { correlationId?: string },
) {
  // 1. Validate doctor eligibility (throws if not verified)
  const doctor = await getDoctorForBooking(input.doctorId);

  // 2. Atomically reserve the slot using SELECT FOR UPDATE
  return prisma.$transaction(async (tx) => {
    // 3. Lock the slot row to prevent concurrent bookings
    const slots = await tx.$queryRaw<Array<{
      id: string;
      doctorId: string;
      startAt: Date;
      endAt: Date;
      status: SlotStatus;
    }>>`
      SELECT id, "doctorId", "startAt", "endAt", status
      FROM availability_slots
      WHERE id = ${input.slotId}::uuid
      FOR UPDATE SKIP LOCKED
    `;

    const slot = slots[0];

    if (!slot) {
      // Slot is either locked by another transaction or doesn't exist
      throw new BookingConflictError('The selected slot is no longer available (concurrent booking)');
    }

    // 4. Re-fetch with a regular query to verify after locking
    const verifiedSlot = await tx.availabilitySlot.findUnique({
      where: { id: input.slotId },
    });

    if (!verifiedSlot) throw new NotFoundError('Availability slot');

    // 5. Verify slot belongs to requested doctor
    if (verifiedSlot.doctorId !== input.doctorId) {
      throw new AppError('Slot does not belong to the requested doctor', 422, 'SLOT_UNAVAILABLE');
    }

    // 6. Verify slot is available
    if (verifiedSlot.status !== SlotStatus.AVAILABLE) {
      throw new BookingConflictError(`Slot is ${verifiedSlot.status.toLowerCase()}`);
    }

    // 7. Verify slot is in the future
    if (verifiedSlot.startAt <= new Date()) {
      throw new AppError('Cannot book a past slot', 422, 'SLOT_UNAVAILABLE');
    }

    // 8. Check for existing consultation for this slot (idempotency guard)
    const existingConsultation = await tx.consultation.findUnique({
      where: { availabilitySlotId: input.slotId },
    });
    if (existingConsultation) {
      if (existingConsultation.patientId === patient.sub) {
        // Same patient — idempotent return
        return existingConsultation;
      }
      throw new BookingConflictError('This slot has already been booked');
    }

    // 9. Check patient doesn't already have a consultation at this time (double-booking guard)
    const patientConflict = await tx.consultation.findFirst({
      where: {
        patientId: patient.sub,
        status: { in: [ConsultationStatus.CONFIRMED, ConsultationStatus.PENDING_PAYMENT] },
        scheduledStartAt: { lt: verifiedSlot.endAt },
        scheduledEndAt: { gt: verifiedSlot.startAt },
      },
    });
    if (patientConflict) {
      throw new AppError(
        'You already have a consultation scheduled at this time',
        409,
        'DUPLICATE_BOOKING',
      );
    }

    // 10. Reserve slot atomically
    await tx.availabilitySlot.update({
      where: { id: input.slotId },
      data: { status: SlotStatus.BOOKED },
    });

    // 11. Create consultation in PENDING_PAYMENT state
    const expiresAt = new Date(Date.now() + env.SLOT_EXPIRY_MINUTES * 60_000);

    const consultation = await tx.consultation.create({
      data: {
        patientId: patient.sub,
        doctorId: input.doctorId,
        availabilitySlotId: input.slotId,
        status: ConsultationStatus.PENDING_PAYMENT,
        reason: input.reason ?? null,
        scheduledStartAt: verifiedSlot.startAt,
        scheduledEndAt: verifiedSlot.endAt,
        expiresAt,
      },
    });

    // 12. Audit log (within same transaction)
    await writeAuditLog(
      {
        actorUserId: patient.sub,
        action: AuditActions.CONSULTATION_BOOKED,
        resourceType: 'Consultation',
        resourceId: consultation.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: {
          doctorId: input.doctorId,
          slotId: input.slotId,
          scheduledStartAt: verifiedSlot.startAt,
          status: ConsultationStatus.PENDING_PAYMENT,
        },
      },
      tx,
    );

    return consultation;
  });
}

// ============================================================
// List consultations (scoped to authenticated user's role)
// ============================================================

export async function listConsultations(actor: JwtPayload, query: ConsultationQueryInput) {
  const where = {
    ...(actor.role === UserRole.PATIENT && { patientId: actor.sub }),
    ...(actor.role === UserRole.DOCTOR && {
      doctor: { userId: actor.sub },
    }),
    ...(query.status && { status: query.status }),
  };

  const [consultations, total] = await Promise.all([
    prisma.consultation.findMany({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { scheduledStartAt: 'desc' },
      select: {
        id: true,
        status: true,
        reason: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        cancellationReason: true,
        cancelledAt: true,
        completedAt: true,
        createdAt: true,
        patient: { select: { profile: { select: { firstName: true, lastName: true } } } },
        doctor: {
          select: {
            specialization: true,
            user: { select: { profile: { select: { firstName: true, lastName: true } } } },
          },
        },
        payment: { select: { status: true, amountMinor: true, currency: true } },
      },
    }),
    prisma.consultation.count({ where }),
  ]);

  return {
    data: consultations,
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
// Get single consultation (with ownership check)
// ============================================================

export async function getConsultationById(actor: JwtPayload, consultationId: string) {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      patient: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } },
      doctor: {
        select: {
          id: true,
          specialization: true,
          userId: true,
          user: { select: { profile: { select: { firstName: true, lastName: true } } } },
        },
      },
      payment: { select: { status: true, amountMinor: true, currency: true, paidAt: true } },
    },
  });

  if (!consultation) throw new NotFoundError('Consultation');

  // Ownership check
  const isPatient = actor.role === UserRole.PATIENT && consultation.patientId === actor.sub;
  const isDoctor = actor.role === UserRole.DOCTOR && consultation.doctor.userId === actor.sub;
  const isAdmin = actor.role === UserRole.ADMIN;

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new ForbiddenError('Access denied to this consultation');
  }

  return consultation;
}

// ============================================================
// Cancel consultation
// ============================================================

export async function cancelConsultation(
  actor: JwtPayload,
  consultationId: string,
  input: CancelConsultationInput,
  meta: { correlationId?: string },
) {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { doctor: { select: { userId: true } } },
  });

  if (!consultation) throw new NotFoundError('Consultation');

  // Ownership check
  const isPatient = actor.role === UserRole.PATIENT && consultation.patientId === actor.sub;
  const isDoctor = actor.role === UserRole.DOCTOR && consultation.doctor.userId === actor.sub;
  const isAdmin = actor.role === UserRole.ADMIN;

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new ForbiddenError('Access denied to this consultation');
  }

  // Cancellation window check for patients
  if (isPatient) {
    const hoursUntil =
      (consultation.scheduledStartAt.getTime() - Date.now()) / (1000 * 3600);
    if (hoursUntil < CANCELLATION_HOURS_BEFORE) {
      throw new AppError(
        `Patients can only cancel at least ${CANCELLATION_HOURS_BEFORE} hours before the appointment`,
        422,
        'CANCELLATION_NOT_ALLOWED',
      );
    }
  }

  validateTransition(consultation.status, ConsultationStatus.CANCELLED);

  await prisma.$transaction(async (tx) => {
    // Release the slot back to AVAILABLE
    await tx.availabilitySlot.update({
      where: { id: consultation.availabilitySlotId },
      data: { status: SlotStatus.AVAILABLE },
    });

    await tx.consultation.update({
      where: { id: consultationId },
      data: {
        status: ConsultationStatus.CANCELLED,
        cancellationReason: input.reason,
        cancelledAt: new Date(),
      },
    });

    await writeAuditLog(
      {
        actorUserId: actor.sub,
        action: AuditActions.CONSULTATION_CANCELLED,
        resourceType: 'Consultation',
        resourceId: consultationId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: {
          previousStatus: consultation.status,
          reason: input.reason,
          actorRole: actor.role,
        },
      },
      tx,
    );
  });
}

// ============================================================
// Complete consultation (doctor/admin only)
// ============================================================

export async function completeConsultation(
  actor: JwtPayload,
  consultationId: string,
  meta: { correlationId?: string },
) {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { doctor: { select: { userId: true } } },
  });

  if (!consultation) throw new NotFoundError('Consultation');

  const isDoctor = actor.role === UserRole.DOCTOR && consultation.doctor.userId === actor.sub;
  const isAdmin = actor.role === UserRole.ADMIN;

  if (!isDoctor && !isAdmin) {
    throw new ForbiddenError('Only the assigned doctor or admin can complete a consultation');
  }

  validateTransition(consultation.status, ConsultationStatus.COMPLETED);

  await prisma.$transaction(async (tx) => {
    await tx.consultation.update({
      where: { id: consultationId },
      data: {
        status: ConsultationStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    await writeAuditLog(
      {
        actorUserId: actor.sub,
        action: AuditActions.CONSULTATION_COMPLETED,
        resourceType: 'Consultation',
        resourceId: consultationId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: { previousStatus: consultation.status },
      },
      tx,
    );
  });
}

// ============================================================
// Mark no-show (doctor/admin only)
// ============================================================

export async function markNoShow(
  actor: JwtPayload,
  consultationId: string,
  meta: { correlationId?: string },
) {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { doctor: { select: { userId: true } } },
  });

  if (!consultation) throw new NotFoundError('Consultation');

  const isDoctor = actor.role === UserRole.DOCTOR && consultation.doctor.userId === actor.sub;
  const isAdmin = actor.role === UserRole.ADMIN;

  if (!isDoctor && !isAdmin) {
    throw new ForbiddenError('Only the assigned doctor or admin can mark a no-show');
  }

  validateTransition(consultation.status, ConsultationStatus.NO_SHOW);

  await prisma.$transaction(async (tx) => {
    await tx.consultation.update({
      where: { id: consultationId },
      data: { status: ConsultationStatus.NO_SHOW },
    });

    await writeAuditLog(
      {
        actorUserId: actor.sub,
        action: AuditActions.CONSULTATION_NO_SHOW,
        resourceType: 'Consultation',
        resourceId: consultationId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });
}

// ============================================================
// Expiry job — release slots for unpaid consultations
// ============================================================

export async function expireUnpaidConsultations(): Promise<number> {
  const now = new Date();

  const expired = await prisma.consultation.findMany({
    where: {
      status: ConsultationStatus.PENDING_PAYMENT,
      expiresAt: { lte: now },
    },
    select: { id: true, availabilitySlotId: true },
  });

  if (expired.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    for (const c of expired) {
      await tx.consultation.update({
        where: { id: c.id },
        data: { status: ConsultationStatus.CANCELLED, cancellationReason: 'PAYMENT_TIMEOUT' },
      });

      await tx.availabilitySlot.update({
        where: { id: c.availabilitySlotId },
        data: { status: SlotStatus.AVAILABLE },
      });

      await writeAuditLog(
        {
          actorUserId: null,
          action: AuditActions.SLOT_EXPIRED,
          resourceType: 'Consultation',
          resourceId: c.id,
          outcome: AuditOutcome.SUCCESS,
          metadata: { reason: 'payment_timeout' },
        },
        tx,
      );
    }
  });

  return expired.length;
}
