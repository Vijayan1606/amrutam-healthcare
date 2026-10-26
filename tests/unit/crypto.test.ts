import { sha256, generateSecureToken, verifyHmacSignature, computeHmacSignature, normalizeEmail } from '../../src/common/utils/crypto';

describe('Crypto Utilities', () => {
  describe('sha256', () => {
    it('produces consistent hash for same input', () => {
      const h1 = sha256('test-input');
      const h2 = sha256('test-input');
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different inputs', () => {
      expect(sha256('input-a')).not.toBe(sha256('input-b'));
    });

    it('produces 64-char hex string', () => {
      expect(sha256('any-input')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('generateSecureToken', () => {
    it('generates token of expected length (32 bytes = 64 hex chars)', () => {
      const token = generateSecureToken(32);
      expect(token.length).toBe(64);
    });

    it('generates different tokens each call', () => {
      const t1 = generateSecureToken();
      const t2 = generateSecureToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('HMAC verification', () => {
    const secret = 'webhook-secret-key';
    const payload = '{"event":"payment.success","amount":50000}';

    it('verifies a valid signature', () => {
      const sig = computeHmacSignature(secret, payload);
      expect(verifyHmacSignature(secret, payload, sig)).toBe(true);
    });

    it('rejects tampered payload', () => {
      const sig = computeHmacSignature(secret, payload);
      expect(verifyHmacSignature(secret, '{"event":"tampered"}', sig)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const sig = computeHmacSignature(secret, payload);
      expect(verifyHmacSignature('wrong-secret', payload, sig)).toBe(false);
    });

    it('rejects empty signature', () => {
      expect(verifyHmacSignature(secret, payload, '')).toBe(false);
    });
  });

  describe('normalizeEmail', () => {
    it('lowercases email', () => {
      expect(normalizeEmail('User@Example.com')).toBe('user@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
    });
  });
});
