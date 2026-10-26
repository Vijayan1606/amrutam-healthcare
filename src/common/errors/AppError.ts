// Centralized application error hierarchy
// All errors carry a machine-readable code, HTTP status, and optional details

export type ErrorCode =
  // Auth errors
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_REVOKED'
  | 'REFRESH_TOKEN_REUSE'
  | 'ACCOUNT_SUSPENDED'
  | 'EMAIL_NOT_VERIFIED'
  | 'UNAUTHENTICATED'
  // Authorization errors
  | 'FORBIDDEN'
  | 'RESOURCE_NOT_FOUND'
  | 'INSUFFICIENT_ROLE'
  // Validation errors
  | 'VALIDATION_ERROR'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_CONFLICT'
  // Business logic errors
  | 'BOOKING_CONFLICT'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_EXPIRED'
  | 'DOCTOR_NOT_VERIFIED'
  | 'DOCTOR_SUSPENDED'
  | 'INVALID_STATUS_TRANSITION'
  | 'PRESCRIPTION_EXISTS'
  | 'DUPLICATE_BOOKING'
  | 'CANCELLATION_NOT_ALLOWED'
  | 'INVALID_CONSULTATION_STATE'
  // Payment errors
  | 'PAYMENT_ALREADY_EXISTS'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'PAYMENT_NOT_FOUND'
  // System errors
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'CONFLICT';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHENTICATED');
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'RESOURCE_NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = 'CONFLICT') {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}

export class BookingConflictError extends AppError {
  constructor(message = 'The selected slot is no longer available') {
    super(message, 409, 'BOOKING_CONFLICT');
    this.name = 'BookingConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('Too many requests. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(message, 500, 'INTERNAL_ERROR', undefined, false);
    this.name = 'InternalError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(`${service} is temporarily unavailable`, 503, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
