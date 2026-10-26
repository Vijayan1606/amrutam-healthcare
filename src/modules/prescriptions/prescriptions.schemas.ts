import { z } from 'zod';
import { uuidSchema } from '../../common/validation/schemas';

export const createPrescriptionSchema = z.object({
  diagnosis: z.string().min(5).max(2000),
  notes: z.string().max(5000).optional(),
  medications: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        dosage: z.string().min(1).max(100),
        frequency: z.string().min(1).max(100),
        durationDays: z.number().int().positive().optional(),
        instructions: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const prescriptionQuerySchema = z.object({
  patientId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type PrescriptionQueryInput = z.infer<typeof prescriptionQuerySchema>;
