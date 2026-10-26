import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../common/middleware/auth';
import { UserRole } from '@prisma/client';
import { idempotencyMiddleware } from '../../common/middleware/idempotency';
import { initiatePayment, handlePaymentWebhook, getPaymentForConsultation } from './payments.service';
import { createPrescriptionSchema } from '../prescriptions/prescriptions.schemas';
import { createPrescription } from '../prescriptions/prescriptions.service';

const router = Router();

// POST /api/v1/consultations/:consultationId/pay — patient initiates payment
router.post(
  '/consultations/:consultationId/pay',
  authenticate,
  requireRole(UserRole.PATIENT),
  idempotencyMiddleware('INITIATE_PAYMENT'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await initiatePayment(
        req.user!,
        req.params['consultationId']!,
        {
          correlationId: req.correlationId,
          idempotencyKey: req.headers['idempotency-key'] as string | undefined,
        },
      );
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/consultations/:consultationId/payment
router.get(
  '/consultations/:consultationId/payment',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getPaymentForConsultation(req.user!, req.params['consultationId']!);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/consultations/:consultationId/prescriptions — doctor creates prescription
router.post(
  '/consultations/:consultationId/prescriptions',
  authenticate,
  requireRole(UserRole.DOCTOR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createPrescriptionSchema.parse(req.body);
      const result = await createPrescription(
        req.user!,
        req.params['consultationId']!,
        input,
        { correlationId: req.correlationId },
      );
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/webhooks/payment — provider webhook
// Note: raw body required for HMAC verification; configured in app.ts
router.post(
  '/webhooks/payment',
  async (req: Request & { rawBody?: string }, res: Response, next: NextFunction) => {
    try {
      const rawBody = req.rawBody ?? JSON.stringify(req.body);
      const signature = req.headers['x-razorpay-signature'] as string ?? req.headers['x-webhook-signature'] as string ?? '';

      const result = await handlePaymentWebhook(rawBody, signature, {
        correlationId: req.correlationId,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
