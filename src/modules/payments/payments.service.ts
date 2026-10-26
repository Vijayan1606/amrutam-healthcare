import { PaymentStatus, ConsultationStatus, AuditOutcome, PaymentProvider as DbPaymentProvider } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import { env } from '../../config/env';
import {
  NotFoundError,
  ForbiddenError,
  AppError,
  ConflictError,
} from '../../common/errors/AppError';
import { writeAuditLog, AuditActions } from '../audit/audit.service';
import { sha256 } from '../../common/utils/crypto';
import { logger } from '../../config/logger';
import { DevPaymentAdapter } from '../../infrastructure/payments/dev.adapter';
import type { PaymentProvider } from '../../infrastructure/payments/payment.provider';
import type { JwtPayload } from '../../common/middleware/auth';

// Payment is only allowed for consultations in this state
const PAYABLE_STATUSES = [ConsultationStatus.PENDING_PAYMENT];

// Load the appropriate payment provider
function getPaymentProvider(): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'dev') {
    return new DevPaymentAdapter();
  }
  // Future: return new RazorpayAdapter(env.RAZORPAY_KEY_ID!, env.RAZORPAY_KEY_SECRET!);
  throw new Error(`Unsupported payment provider: ${env.PAYMENT_PROVIDER}`);
}

const paymentProvider = getPaymentProvider();

// ============================================================
// Initiate payment
// ============================================================

export async function initiatePayment(
  actor: JwtPayload,
  consultationId: string,
  meta: { correlationId?: string; idempotencyKey?: string },
) {
  // Load consultation
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      doctor: {
        select: { consultationFeeMinor: true, currency: true, userId: true },
      },
      payment: true,
    },
  });

  if (!consultation) throw new NotFoundError('Consultation');

  // Ownership check — patient must own this consultation
  if (consultation.patientId !== actor.sub) {
    throw new ForbiddenError('Access denied to this consultation');
  }

  // Verify consultation is payable
  if (!PAYABLE_STATUSES.includes(consultation.status)) {
    throw new AppError(
      `Consultation status is ${consultation.status}; payment is only accepted for ${PAYABLE_STATUSES.join(', ')} consultations`,
      422,
      'INVALID_CONSULTATION_STATE',
    );
  }

  // Idempotency: return existing payment if already initiated
  if (consultation.payment) {
    if ([PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING].includes(consultation.payment.status)) {
      return consultation.payment;
    }
    if (consultation.payment.status === PaymentStatus.PENDING) {
      // Return existing pending payment (client retry)
      return consultation.payment;
    }
    if (consultation.payment.status === PaymentStatus.FAILED) {
      throw new AppError('Previous payment failed. Please contact support.', 409, 'PAYMENT_FAILED');
    }
  }

  // Derive amount from server-side data (client cannot set the amount)
  const amountMinor = consultation.doctor.consultationFeeMinor;
  const currency = consultation.doctor.currency;

  const idempotencyKeyHash = meta.idempotencyKey ? sha256(meta.idempotencyKey) : null;

  // Create payment record in PENDING state
  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        consultationId,
        patientId: actor.sub,
        amountMinor,
        currency,
        status: PaymentStatus.PENDING,
        provider: env.PAYMENT_PROVIDER === 'dev' ? DbPaymentProvider.DEV : DbPaymentProvider.RAZORPAY,
        idempotencyKeyHash,
      },
    });

    await writeAuditLog(
      {
        actorUserId: actor.sub,
        action: AuditActions.PAYMENT_INITIATED,
        resourceType: 'Payment',
        resourceId: created.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
        metadata: { amountMinor, currency, consultationId },
      },
      tx,
    );

    return created;
  });

  // Initiate with provider (OUTSIDE transaction — external call)
  try {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PROCESSING },
    });

    const result = await paymentProvider.createPayment({
      consultationId,
      patientId: actor.sub,
      amountMinor,
      currency,
      idempotencyKey: meta.idempotencyKey ?? payment.id,
    });

    // Update with provider result
    const finalStatus =
      result.status === 'SUCCEEDED'
        ? PaymentStatus.SUCCEEDED
        : result.status === 'FAILED'
        ? PaymentStatus.FAILED
        : PaymentStatus.PROCESSING;

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: finalStatus,
          providerReference: result.providerReference,
          paidAt: finalStatus === PaymentStatus.SUCCEEDED ? new Date() : null,
        },
      });

      // If payment succeeded immediately (dev adapter), confirm consultation
      if (finalStatus === PaymentStatus.SUCCEEDED) {
        await tx.consultation.update({
          where: { id: consultationId },
          data: { status: ConsultationStatus.CONFIRMED, expiresAt: null },
        });

        await writeAuditLog(
          {
            actorUserId: actor.sub,
            action: AuditActions.PAYMENT_SUCCEEDED,
            resourceType: 'Payment',
            resourceId: payment.id,
            outcome: AuditOutcome.SUCCESS,
            correlationId: meta.correlationId,
            metadata: {
              providerReference: result.providerReference,
              amountMinor,
              currency,
            },
          },
          tx,
        );

        await writeAuditLog(
          {
            actorUserId: actor.sub,
            action: AuditActions.CONSULTATION_CONFIRMED,
            resourceType: 'Consultation',
            resourceId: consultationId,
            outcome: AuditOutcome.SUCCESS,
            correlationId: meta.correlationId,
          },
          tx,
        );
      }
    });

    return await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  } catch (err) {
    // Mark as failed if provider call throws
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failureReasonCode: 'PROVIDER_ERROR' },
    }).catch(() => {/* swallow update failure */});

    logger.error({ err, paymentId: payment.id }, 'Payment provider error');
    throw new AppError('Payment initiation failed', 502, 'PAYMENT_FAILED');
  }
}

// ============================================================
// Webhook handler (verified HMAC)
// ============================================================

export async function handlePaymentWebhook(
  rawBody: string,
  signature: string,
  meta: { correlationId?: string },
) {
  // Webhook secret fallback for dev
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? 'dev-webhook-secret';

  const verification = await paymentProvider.verifyWebhook(rawBody, signature, webhookSecret);

  await writeAuditLog({
    actorUserId: null,
    action: verification.valid ? AuditActions.WEBHOOK_RECEIVED : AuditActions.WEBHOOK_REJECTED,
    resourceType: 'Payment',
    resourceId: verification.providerReference ?? null,
    outcome: verification.valid ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
    correlationId: meta.correlationId,
  });

  if (!verification.valid) {
    throw new AppError('Webhook signature verification failed', 401, 'WEBHOOK_SIGNATURE_INVALID');
  }

  const { providerReference, status } = verification;
  if (!providerReference || !status) {
    throw new AppError('Webhook payload missing required fields', 400, 'VALIDATION_ERROR');
  }

  // Find payment by provider reference
  const payment = await prisma.payment.findFirst({
    where: { providerReference },
    include: { consultation: true },
  });

  if (!payment) {
    logger.warn({ providerReference }, 'Webhook for unknown payment reference — ignoring');
    return { received: true };
  }

  // Idempotency: skip duplicate processing
  if (payment.webhookProcessedAt) {
    await writeAuditLog({
      actorUserId: null,
      action: AuditActions.WEBHOOK_REPLAY,
      resourceType: 'Payment',
      resourceId: payment.id,
      outcome: AuditOutcome.SUCCESS,
      correlationId: meta.correlationId,
      metadata: { providerReference },
    });
    return { received: true, replayed: true };
  }

  // Process the event
  await prisma.$transaction(async (tx) => {
    const newPaymentStatus =
      status === 'SUCCEEDED'
        ? PaymentStatus.SUCCEEDED
        : status === 'FAILED'
        ? PaymentStatus.FAILED
        : status === 'REFUNDED'
        ? PaymentStatus.REFUNDED
        : payment.status;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: newPaymentStatus,
        webhookProcessedAt: new Date(),
        paidAt: newPaymentStatus === PaymentStatus.SUCCEEDED ? new Date() : payment.paidAt,
        failureReasonCode: verification.failureReasonCode ?? null,
      },
    });

    // Update consultation status based on payment
    if (newPaymentStatus === PaymentStatus.SUCCEEDED && payment.consultation.status === ConsultationStatus.PENDING_PAYMENT) {
      await tx.consultation.update({
        where: { id: payment.consultationId },
        data: { status: ConsultationStatus.CONFIRMED, expiresAt: null },
      });

      await writeAuditLog(
        {
          actorUserId: null,
          action: AuditActions.CONSULTATION_CONFIRMED,
          resourceType: 'Consultation',
          resourceId: payment.consultationId,
          outcome: AuditOutcome.SUCCESS,
          correlationId: meta.correlationId,
          metadata: { trigger: 'webhook' },
        },
        tx,
      );
    }

    if (newPaymentStatus === PaymentStatus.FAILED && payment.consultation.status !== ConsultationStatus.CANCELLED) {
      await writeAuditLog(
        {
          actorUserId: null,
          action: AuditActions.PAYMENT_FAILED,
          resourceType: 'Payment',
          resourceId: payment.id,
          outcome: AuditOutcome.FAILURE,
          correlationId: meta.correlationId,
          metadata: { providerReference, failureCode: verification.failureReasonCode },
        },
        tx,
      );
    }
  });

  return { received: true };
}

// ============================================================
// Get payment for a consultation (patient/doctor/admin)
// ============================================================

export async function getPaymentForConsultation(actor: JwtPayload, consultationId: string) {
  const payment = await prisma.payment.findUnique({
    where: { consultationId },
  });

  if (!payment) throw new NotFoundError('Payment');

  if (actor.role === 'PATIENT' && payment.patientId !== actor.sub) {
    throw new ForbiddenError('Access denied to this payment');
  }

  return payment;
}
