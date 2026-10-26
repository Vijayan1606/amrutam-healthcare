import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { UnauthenticatedError, ForbiddenError } from '../errors/AppError';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

// Extend Express Request with authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Validates a JWT access token.
 * Rejects unsigned, expired, tampered, or algorithm-switched tokens.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthenticatedError('Bearer token required'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],  // Explicit algorithm allowlist — prevents alg=none attacks
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as JwtPayload;

    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new UnauthenticatedError('Access token has expired'));
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new UnauthenticatedError('Invalid access token'));
    }
    next(new UnauthenticatedError('Token validation failed'));
  }
}

/**
 * Requires one of the given roles.
 * Must be used AFTER authenticate().
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthenticatedError());
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

/**
 * Requires the authenticated user to be the resource owner OR an admin.
 */
export function requireOwnerOrAdmin(getOwnerId: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthenticatedError());
    }
    const ownerId = getOwnerId(req);
    if (req.user.sub !== ownerId && req.user.role !== UserRole.ADMIN) {
      return next(new ForbiddenError('Access denied to this resource'));
    }
    next();
  };
}
