import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../../common/middleware/auth';
import { UserRole } from '@prisma/client';
import {
  createDoctorProfileSchema,
  updateDoctorProfileSchema,
  doctorQuerySchema,
  verifyDoctorSchema,
  suspendDoctorSchema,
} from './doctors.schemas';
import {
  listDoctors,
  getDoctorById,
  getMyDoctorProfile,
  updateMyDoctorProfile,
  createDoctorProfile,
  verifyDoctor,
  suspendDoctor,
} from './doctors.service';
import { authenticate } from '../../common/middleware/auth';
import { slotQuerySchema } from '../availability/availability.schemas';
import { listDoctorAvailability } from '../availability/availability.service';

const router = Router();

// GET /api/v1/doctors — public
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = doctorQuerySchema.parse(req.query);
    const result = await listDoctors(query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/doctors/me — doctor only
router.get('/me', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getMyDoctorProfile(req.user!.sub);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/doctors/me — create doctor profile (doctor users only)
router.post('/me', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createDoctorProfileSchema.parse(req.body);
    const result = await createDoctorProfile(req.user!.sub, input, { correlationId: req.correlationId });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/doctors/me — update own doctor profile
router.patch('/me', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateDoctorProfileSchema.parse(req.body);
    const result = await updateMyDoctorProfile(req.user!.sub, input);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/doctors/:doctorId — public
router.get('/:doctorId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getDoctorById(req.params['doctorId']!);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/doctors/:doctorId/availability — public
router.get('/:doctorId/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = slotQuerySchema.parse(req.query);
    const result = await listDoctorAvailability(req.params['doctorId']!, query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/doctors/:doctorId/verify — admin only
router.patch('/:doctorId/verify', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await verifyDoctor(req.user!.sub, req.params['doctorId']!, { correlationId: req.correlationId });
    res.status(200).json({ data: { message: 'Doctor verified successfully' } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/doctors/:doctorId/suspend — admin only
router.patch('/:doctorId/suspend', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = suspendDoctorSchema.parse({ ...req.body, doctorId: req.params['doctorId'] });
    await suspendDoctor(req.user!.sub, input.doctorId, input.reason, { correlationId: req.correlationId });
    res.status(200).json({ data: { message: 'Doctor suspended' } });
  } catch (err) {
    next(err);
  }
});

export default router;
