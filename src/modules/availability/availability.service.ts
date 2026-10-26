import { SlotStatus, AuditOutcome } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  AppError,
} from '../../common/errors/AppError';
import { writeAuditLog, AuditActions } from '../audit/audit.service';
import type { CreateSlotInput, UpdateSlotInput, SlotQueryInput } from './availability.schemas';

// ============================================================
// Create availability slot
// ============================================================

export async function createAvailabilitySlot(
  userId: string,
  input: CreateSlotInput,
  meta: { correlationId?: string },
) {
  // Find doctor profile for this user
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!doctor) throw new NotFoundError('Doctor profile');

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);

  // Check for overlapping slots for this doctor (application-level guard before DB insert)
  const overlap = await prisma.availabilitySlot.findFirst({
    where: {
      doctorId: doctor.id,
      status: { notIn: [SlotStatus.CANCELLED] },
      OR: [
        // New slot starts inside existing
        { startAt: { lte: startAt }, endAt: { gt: startAt } },
        // New slot ends inside existing
        { startAt: { lt: endAt }, endAt: { gte: endAt } },
        // New slot completely contains existing
        { startAt: { gte: startAt }, endAt: { lte: endAt } },
      ],
    },
  });

  if (overlap) {
    throw new ConflictError(
      `This time slot overlaps with an existing slot (${overlap.startAt.toISOString()} – ${overlap.endAt.toISOString()})`,
      'BOOKING_CONFLICT',
    );
  }

  const slot = await prisma.$transaction(async (tx) => {
    const created = await tx.availabilitySlot.create({
      data: {
        doctorId: doctor.id,
        startAt,
        endAt,
        status: SlotStatus.AVAILABLE,
      },
    });

    await writeAuditLog(
      {
        actorUserId: userId,
        action: AuditActions.SLOT_CREATED,
        resourceType: 'AvailabilitySlot',
        resourceId: created.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: { doctorId: doctor.id },
      },
      tx,
    );

    return created;
  });

  return slot;
}

// ============================================================
// List doctor's availability
// ============================================================

export async function listDoctorAvailability(doctorId: string, query: SlotQueryInput) {
  const where = {
    doctorId,
    ...(query.startDate && { startAt: { gte: new Date(query.startDate) } }),
    ...(query.endDate && { endAt: { lte: new Date(query.endDate) } }),
    ...(query.status ? { status: query.status } : { status: { in: [SlotStatus.AVAILABLE, SlotStatus.BOOKED] } }),
  };

  const [slots, total] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { startAt: 'asc' },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.availabilitySlot.count({ where }),
  ]);

  return {
    data: slots,
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
// Update slot (owner only)
// ============================================================

export async function updateSlot(
  userId: string,
  slotId: string,
  input: UpdateSlotInput,
  meta: { correlationId?: string },
) {
  const doctor = await prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor) throw new NotFoundError('Doctor profile');

  const slot = await prisma.availabilitySlot.findUnique({ where: { id: slotId } });
  if (!slot) throw new NotFoundError('Availability slot');

  if (slot.doctorId !== doctor.id) throw new ForbiddenError('You do not own this slot');
  if (slot.status === SlotStatus.BOOKED) {
    throw new AppError('Cannot modify a booked slot', 409, 'BOOKING_CONFLICT');
  }
  if (slot.status === SlotStatus.CANCELLED) {
    throw new AppError('Cannot modify a cancelled slot', 409, 'SLOT_UNAVAILABLE');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.availabilitySlot.update({
      where: { id: slotId },
      data: { status: input.status ?? slot.status },
    });

    await writeAuditLog(
      {
        actorUserId: userId,
        action: AuditActions.SLOT_UPDATED,
        resourceType: 'AvailabilitySlot',
        resourceId: slotId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: { previousStatus: slot.status, newStatus: input.status },
      },
      tx,
    );

    return result;
  });

  return updated;
}

// ============================================================
// Delete (cancel) slot (owner only)
// ============================================================

export async function deleteSlot(
  userId: string,
  slotId: string,
  meta: { correlationId?: string },
) {
  const doctor = await prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor) throw new NotFoundError('Doctor profile');

  const slot = await prisma.availabilitySlot.findUnique({ where: { id: slotId } });
  if (!slot) throw new NotFoundError('Availability slot');

  if (slot.doctorId !== doctor.id) throw new ForbiddenError('You do not own this slot');
  if (slot.status === SlotStatus.BOOKED) {
    throw new AppError(
      'Cannot delete a booked slot. Cancel the consultation first.',
      409,
      'BOOKING_CONFLICT',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.availabilitySlot.update({
      where: { id: slotId },
      data: { status: SlotStatus.CANCELLED },
    });

    await writeAuditLog(
      {
        actorUserId: userId,
        action: AuditActions.SLOT_DELETED,
        resourceType: 'AvailabilitySlot',
        resourceId: slotId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });
}
