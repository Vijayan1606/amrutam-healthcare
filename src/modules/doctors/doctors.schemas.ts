import { z } from 'zod';
import { uuidSchema, monetaryAmountSchema, currencySchema } from '../../common/validation/schemas';

export const createDoctorProfileSchema = z.object({
  licenseNumber: z.string().min(3).max(100),
  specialization: z.string().min(2).max(100),
  qualifications: z.array(z.string().min(1).max(200)).min(1).max(20),
  biography: z.string().max(2000).optional(),
  consultationFeeMinor: monetaryAmountSchema,
  currency: currencySchema,
});

export const updateDoctorProfileSchema = z.object({
  biography: z.string().max(2000).optional(),
  qualifications: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  consultationFeeMinor: monetaryAmountSchema.optional(),
});

export const doctorQuerySchema = z.object({
  specialization: z.string().optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  verifiedOnly: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export const verifyDoctorSchema = z.object({
  doctorId: uuidSchema,
});

export const suspendDoctorSchema = z.object({
  doctorId: uuidSchema,
  reason: z.string().min(10).max(1000),
});

export type CreateDoctorProfileInput = z.infer<typeof createDoctorProfileSchema>;
export type UpdateDoctorProfileInput = z.infer<typeof updateDoctorProfileSchema>;
export type DoctorQueryInput = z.infer<typeof doctorQuerySchema>;
