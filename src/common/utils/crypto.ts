import crypto from 'crypto';

/**
 * Creates a SHA-256 hex digest of the input.
 * Used for storing token hashes, idempotency key hashes, etc.
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Generates a cryptographically secure random hex string.
 * @param bytes Number of random bytes (default 32 = 256 bits)
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do the comparison to prevent length-timing leaks, then return false
    crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(a, 'utf8'));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Derives a SHA-256 HMAC signature for webhook verification.
 */
export function computeHmacSignature(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verifies a webhook HMAC signature using constant-time comparison.
 */
export function verifyHmacSignature(secret: string, payload: string, signature: string): boolean {
  const expected = computeHmacSignature(secret, payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Normalizes email: lowercase, trim.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Formats a monetary amount from minor units for display.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(major);
}
