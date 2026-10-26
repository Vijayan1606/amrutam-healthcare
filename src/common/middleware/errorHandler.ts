import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, isAppError, ValidationError } from '../errors/AppError';
import { logger } from '../../config/logger';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

function buildErrorResponse(
  code: string,
  message: string,
  requestId?: string,
  details?: unknown,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined && { details }),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { correlationId?: string }).correlationId;

  // Zod validation errors
  if (error instanceof ZodError) {
    const ve = new ValidationError('Request validation failed', error.flatten().fieldErrors);
    res
      .status(ve.statusCode)
      .json(buildErrorResponse(ve.code, ve.message, requestId, ve.details));
    return;
  }

  // Prisma unique constraint violation
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      logger.warn({ error: error.code, meta: error.meta, requestId }, 'Unique constraint violation');
      res
        .status(409)
        .json(buildErrorResponse('CONFLICT', 'A record with this value already exists', requestId));
      return;
    }
    if (error.code === 'P2025') {
      res
        .status(404)
        .json(buildErrorResponse('RESOURCE_NOT_FOUND', 'Record not found', requestId));
      return;
    }
    // Other Prisma errors → obscure from client
    logger.error({ err: error, requestId }, 'Prisma database error');
    res
      .status(500)
      .json(buildErrorResponse('DATABASE_ERROR', 'A database error occurred', requestId));
    return;
  }

  // Prisma connection errors
  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.fatal({ err: error, requestId }, 'Prisma initialization error');
    res
      .status(503)
      .json(buildErrorResponse('SERVICE_UNAVAILABLE', 'Database connection unavailable', requestId));
    return;
  }

  // Known application errors
  if (isAppError(error)) {
    const level = error.statusCode >= 500 ? 'error' : 'warn';
    logger[level]({ err: error, requestId, code: error.code }, error.message);

    // Only include details for client errors (4xx), never for 5xx
    const safeDetails = error.statusCode < 500 ? error.details : undefined;

    res
      .status(error.statusCode)
      .json(buildErrorResponse(error.code, error.message, requestId, safeDetails));
    return;
  }

  // Unexpected errors — log full details, return generic message
  logger.error({ err: error, requestId }, 'Unhandled error');
  res
    .status(500)
    .json(
      buildErrorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        requestId,
      ),
    );
}
