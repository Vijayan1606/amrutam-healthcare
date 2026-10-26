import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request with correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

const CORRELATION_HEADER = 'X-Correlation-Id';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assigns or validates a correlation ID for every request.
 * Client-provided IDs are validated (UUID format) and accepted.
 * Invalid or missing IDs are replaced with a server-generated UUID.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientId = req.headers[CORRELATION_HEADER.toLowerCase()] as string | undefined;

  // Validate client-provided correlation ID (must be a UUID)
  const correlationId =
    clientId && UUID_REGEX.test(clientId) ? clientId : uuidv4();

  req.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  next();
}
