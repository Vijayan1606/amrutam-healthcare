import { z } from 'zod';
import { uuidSchema } from '../../common/validation/schemas';

export const bookConsultationSchema = z.object({
  doctorId: uuidSchema,
  slotId: uuidSchema,
  reason: z.string().min(10).max(1000).optional(),
});

export const cancelConsultationSchema = z.object({
  reason: z.string().min(5).max(1000),
});

export const completeConsultationSchema = z.object({
  consultationId: uuidSchema,
});

export const consultationQuerySchema = z.object({
  status: z
    .enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type BookConsultationInput = z.infer<typeof bookConsultationSchema>;
export type CancelConsultationInput = z.infer<typeof cancelConsultationSchema>;
export type ConsultationQueryInput = z.infer<typeof consultationQuerySchema>;
