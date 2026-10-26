import { z } from 'zod';

// ============================================================
// Common pagination
// ============================================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / params.limit);
  return {
    data,
    pagination: {
      total,
      page: params.page,
      limit: params.limit,
      totalPages,
      hasNext: params.page < totalPages,
      hasPrev: params.page > 1,
    },
  };
}

// ============================================================
// Common field schemas
// ============================================================

export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const emailSchema = z
  .string()
  .email('Must be a valid email address')
  .max(254)
  .transform((e) => e.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Must be a valid international phone number')
  .optional();

export const timezoneSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z_\/]+$/, 'Must be a valid IANA timezone')
  .default('Asia/Kolkata');

export const dateRangeSchema = z
  .object({
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (data) =>
      !data.startDate ||
      !data.endDate ||
      new Date(data.startDate) < new Date(data.endDate),
    { message: 'startDate must be before endDate' },
  );

export const monetaryAmountSchema = z
  .number()
  .int('Amount must be an integer number of minor units')
  .nonnegative('Amount must not be negative');

export const currencySchema = z
  .string()
  .length(3, 'Currency must be a 3-letter ISO code')
  .regex(/^[A-Z]{3}$/, 'Currency must be uppercase ISO 4217 code')
  .default('INR');
