import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../infrastructure/database/client';
import { sha256 } from '../utils/crypto';
import { AppError } from '../errors/AppError';
import { logger } from '../../config/logger';
import { env } from '../../config/env';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const KEY_MIN_LENGTH = 8;
const KEY_MAX_LENGTH = 255;

const idempotencyKeySchema = z
  .string()
  .min(KEY_MIN_LENGTH, `Idempotency-Key must be at least ${KEY_MIN_LENGTH} characters`)
  .max(KEY_MAX_LENGTH, `Idempotency-Key must be at most ${KEY_MAX_LENGTH} characters`)
  .regex(/^[\x20-\x7E]+$/, 'Idempotency-Key must contain only printable ASCII characters');

export interface IdempotencyResult {
  isCached: boolean;
  responseStatus?: number;
  responseBody?: unknown;
}

/**
 * Express middleware for idempotent endpoints.
 * Requires authentication middleware to run first (req.user must be set).
 *
 * @param operation - The operation name to scope the idempotency key (e.g., "BOOK_CONSULTATION")
 */
export function idempotencyMiddleware(operation: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER] as string | undefined;

    if (!rawKey) {
      return next(
        new AppError(
          `Idempotency-Key header is required for this operation`,
          400,
          'INVALID_IDEMPOTENCY_KEY',
        ),
      );
    }

    const parseResult = idempotencyKeySchema.safeParse(rawKey);
    if (!parseResult.success) {
      return next(
        new AppError(
          parseResult.error.errors[0]?.message ?? 'Invalid Idempotency-Key',
          400,
          'INVALID_IDEMPOTENCY_KEY',
        ),
      );
    }

    const userId = req.user?.sub;
    if (!userId) {
      return next(new AppError('Authentication required for idempotency', 401, 'UNAUTHENTICATED'));
    }

    const keyHash = sha256(rawKey);
    const requestBodyHash = sha256(JSON.stringify(req.body));

    try {
      // Look up existing idempotency record
      const existing = await prisma.idempotencyKey.findUnique({
        where: { userId_operation_keyHash: { userId, operation, keyHash } },
      });

      if (existing) {
        // Key exists and is still valid (not expired)
        if (existing.expiresAt < new Date()) {
          // Expired — treat as new request
          await prisma.idempotencyKey.delete({ where: { id: existing.id } });
        } else {
          // Validate payload fingerprint — reject reuse with different body
          if (existing.requestBodyHash !== requestBodyHash) {
            return next(
              new AppError(
                'Idempotency-Key has already been used with a different request payload',
                409,
                'IDEMPOTENCY_CONFLICT',
              ),
            );
          }

          if (existing.completedAt && existing.responseBody !== null && existing.responseStatus !== null) {
            // Return cached response
            logger.info(
              { userId, operation, keyHash: keyHash.slice(0, 8) },
              'Returning cached idempotency response',
            );
            res
              .status(existing.responseStatus)
              .setHeader('Idempotency-Replay', 'true')
              .json(JSON.parse(existing.responseBody!));
            return;
          }

          // In-flight — client is retrying before completion (409 is appropriate)
          return next(
            new AppError(
              'A request with this Idempotency-Key is still being processed',
              409,
              'IDEMPOTENCY_CONFLICT',
            ),
          );
        }
      }

      // Create new idempotency record (in-flight)
      const expiresAt = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      );

      let keyId: string;
      try {
        const created = await prisma.idempotencyKey.create({
          data: { userId, operation, keyHash, requestBodyHash, expiresAt },
        });
        keyId = created.id;
      } catch (createErr: unknown) {
        // Race: another concurrent request created the record first
        const { Prisma } = await import('@prisma/client');
        if (
          createErr instanceof Prisma.PrismaClientKnownRequestError &&
          createErr.code === 'P2002'
        ) {
          return next(
            new AppError(
              'A request with this Idempotency-Key is still being processed',
              409,
              'IDEMPOTENCY_CONFLICT',
            ),
          );
        }
        throw createErr;
      }

      // Intercept the response to cache the result
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode;
        const bodyString = JSON.stringify(body);

        // Fire-and-forget to update the idempotency record
        prisma.idempotencyKey
          .update({
            where: { id: keyId },
            data: {
              responseBody: bodyString,
              responseStatus: status,
              completedAt: new Date(),
            },
          })
          .catch((err) => {
            logger.error({ err }, 'Failed to persist idempotency response');
          });

        return originalJson(body);
      };

      // Attach expiry info to env for use in background cleanup
      void env; // suppress unused warning

      next();
    } catch (err) {
      logger.error({ err, operation, userId }, 'Idempotency middleware error');
      next(err);
    }
  };
}
