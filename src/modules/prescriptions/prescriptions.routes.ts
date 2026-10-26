import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../common/middleware/auth';
import { UserRole } from '@prisma/client';
import { createPrescriptionSchema, prescriptionQuerySchema } from './prescriptions.schemas';
import {
  createPrescription,
  getPrescriptionById,
  listMyPrescriptions,
  listDoctorPrescriptions,
} from './prescriptions.service';

const router = Router();

// GET /api/v1/prescriptions — patient sees their own; doctor sees ones they issued
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = prescriptionQuerySchema.parse(req.query);
    if (req.user!.role === UserRole.PATIENT) {
      const result = await listMyPrescriptions(req.user!, query);
      res.status(200).json(result);
    } else if (req.user!.role === UserRole.DOCTOR) {
      const result = await listDoctorPrescriptions(req.user!, query);
      res.status(200).json(result);
    } else {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admins do not have access to prescription lists' } });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/prescriptions/:id
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getPrescriptionById(req.user!, req.params['id']!);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
