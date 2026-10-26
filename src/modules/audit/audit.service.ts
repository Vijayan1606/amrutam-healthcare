import { AuditOutcome, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import { logger } from '../../config/logger';

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: AuditOutcome;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit log entry.
 * Never throws — audit failures are logged but must not break business operations.
 * For transactional writes (within a tx), pass the tx client as the second parameter.
 */
export async function writeAuditLog(
  event: AuditEventInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;

  try {
    await client.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        outcome: event.outcome ?? AuditOutcome.SUCCESS,
        correlationId: event.correlationId ?? null,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent?.slice(0, 499) ?? null,
        metadata: event.metadata ? (event.metadata as Prisma.JsonObject) : Prisma.JsonNull,
      },
    });
  } catch (err) {
    // Log but don't propagate — audit failure must not break the primary operation
    logger.error({ err, event: event.action }, 'Failed to write audit log');
  }
}

// ===== Well-known audit action constants ==========================================

export const AuditActions = {
  // Auth
  REGISTER: 'AUTH.REGISTER',
  LOGIN_SUCCESS: 'AUTH.LOGIN.SUCCESS',
  LOGIN_FAILURE: 'AUTH.LOGIN.FAILURE',
  LOGOUT: 'AUTH.LOGOUT',
  LOGOUT_ALL: 'AUTH.LOGOUT_ALL',
  REFRESH_TOKEN: 'AUTH.TOKEN.REFRESH',
  REFRESH_TOKEN_REUSE: 'AUTH.TOKEN.REUSE_DETECTED',
  PASSWORD_RESET_REQUESTED: 'AUTH.PASSWORD_RESET.REQUESTED',
  PASSWORD_RESET_COMPLETED: 'AUTH.PASSWORD_RESET.COMPLETED',

  // Account
  ACCOUNT_SUSPENDED: 'USER.SUSPENDED',
  ACCOUNT_ACTIVATED: 'USER.ACTIVATED',

  // Doctors
  DOCTOR_PROFILE_CREATED: 'DOCTOR.PROFILE.CREATED',
  DOCTOR_VERIFIED: 'DOCTOR.VERIFIED',
  DOCTOR_SUSPENDED: 'DOCTOR.SUSPENDED',

  // Availability
  SLOT_CREATED: 'SLOT.CREATED',
  SLOT_UPDATED: 'SLOT.UPDATED',
  SLOT_DELETED: 'SLOT.DELETED',
  SLOT_EXPIRED: 'SLOT.EXPIRED',

  // Consultations
  CONSULTATION_BOOKED: 'CONSULTATION.BOOKED',
  CONSULTATION_CANCELLED: 'CONSULTATION.CANCELLED',
  CONSULTATION_COMPLETED: 'CONSULTATION.COMPLETED',
  CONSULTATION_NO_SHOW: 'CONSULTATION.NO_SHOW',
  CONSULTATION_CONFIRMED: 'CONSULTATION.CONFIRMED',

  // Prescriptions
  PRESCRIPTION_CREATED: 'PRESCRIPTION.CREATED',
  PRESCRIPTION_UPDATED: 'PRESCRIPTION.UPDATED',

  // Payments
  PAYMENT_INITIATED: 'PAYMENT.INITIATED',
  PAYMENT_SUCCEEDED: 'PAYMENT.SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT.FAILED',
  PAYMENT_REFUNDED: 'PAYMENT.REFUNDED',
  WEBHOOK_RECEIVED: 'PAYMENT.WEBHOOK.RECEIVED',
  WEBHOOK_REJECTED: 'PAYMENT.WEBHOOK.REJECTED',
  WEBHOOK_REPLAY: 'PAYMENT.WEBHOOK.REPLAY',

  // Security
  PERMISSION_DENIED: 'SEC.PERMISSION_DENIED',
  RATE_LIMITED: 'SEC.RATE_LIMITED',
} as const;
