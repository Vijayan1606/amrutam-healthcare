import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../common/middleware/auth';
import { UserRole } from '@prisma/client';
import {
  createSlotSchema,
  updateSlotSchema,
  slotQuerySchema,
} from './availability.schemas';
import {
  createAvailabilitySlot,
  listDoctorAvailability,
  updateSlot,
  deleteSlot,
} from './availability.service';

const router = Router();

// POST /api/v1/doctors/me/availability
router.post('/', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSlotSchema.parse(req.body);
    const result = await createAvailabilitySlot(req.user!.sub, input, { correlationId: req.correlationId });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/doctors/me/availability
router.get('/', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = slotQuerySchema.parse(req.query);
    // Find doctor ID for this user
    const { prisma } = await import('../../infrastructure/database/client');
    const doctor = await prisma.doctor.findUnique({
      where: { userId: req.user!.sub },
      select: { id: true },
    });
    if (!doctor) {
      res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Doctor profile not found' } });
      return;
    }
    const result = await listDoctorAvailability(doctor.id, query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/doctors/me/availability/:slotId
router.patch('/:slotId', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateSlotSchema.parse(req.body);
    const result = await updateSlot(req.user!.sub, req.params['slotId']!, input, { correlationId: req.correlationId });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/doctors/me/availability/:slotId
router.delete('/:slotId', authenticate, requireRole(UserRole.DOCTOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteSlot(req.user!.sub, req.params['slotId']!, { correlationId: req.correlationId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
