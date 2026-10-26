import { z } from 'zod';

export const createSlotSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .refine((d) => new Date(d.startAt) < new Date(d.endAt), {
    message: 'startAt must be before endAt',
  })
  .refine((d) => new Date(d.startAt) > new Date(), {
    message: 'Cannot create slots in the past',
  });

export const updateSlotSchema = z.object({
  status: z.enum(['BLOCKED', 'AVAILABLE']).optional(),
});

export const slotQuerySchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['AVAILABLE', 'BOOKED', 'BLOCKED', 'CANCELLED']).optional(),
});

export type CreateSlotInput = z.infer<typeof createSlotSchema>;
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;
export type SlotQueryInput = z.infer<typeof slotQuerySchema>;
