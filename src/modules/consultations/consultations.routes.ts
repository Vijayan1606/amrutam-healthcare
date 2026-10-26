import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../common/middleware/auth';
import { UserRole } from '@prisma/client';
import { idempotencyMiddleware } from '../../common/middleware/idempotency';
import {
  bookConsultationSchema,
  cancelConsultationSchema,
  consultationQuerySchema,
} from './consultations.schemas';
import {
  bookConsultation,
  listConsultations,
  getConsultationById,
  cancelConsultation,
  completeConsultation,
  markNoShow,
} from './consultations.service';

const router = Router();

// POST /api/v1/consultations — book appointment (patient)
router.post(
  '/',
  authenticate,
  requireRole(UserRole.PATIENT),
  idempotencyMiddleware('BOOK_CONSULTATION'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = bookConsultationSchema.parse(req.body);
      const result = await bookConsultation(req.user!, input, { correlationId: req.correlationId });
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/consultations — list (patient sees own; doctor sees assigned)
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = consultationQuerySchema.parse(req.query);
    const result = await listConsultations(req.user!, query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/consultations/:id
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getConsultationById(req.user!, req.params['id']!);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/consultations/:id/cancel
router.post('/:id/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = cancelConsultationSchema.parse(req.body);
    await cancelConsultation(req.user!, req.params['id']!, input, { correlationId: req.correlationId });
    res.status(200).json({ data: { message: 'Consultation cancelled successfully' } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/consultations/:id/complete — doctor/admin
router.post(
  '/:id/complete',
  authenticate,
  requireRole(UserRole.DOCTOR, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await completeConsultation(req.user!, req.params['id']!, { correlationId: req.correlationId });
      res.status(200).json({ data: { message: 'Consultation marked as completed' } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/consultations/:id/no-show — doctor/admin
router.post(
  '/:id/no-show',
  authenticate,
  requireRole(UserRole.DOCTOR, UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await markNoShow(req.user!, req.params['id']!, { correlationId: req.correlationId });
      res.status(200).json({ data: { message: 'Consultation marked as no-show' } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
