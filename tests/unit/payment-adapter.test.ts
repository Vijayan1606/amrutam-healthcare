import { DevPaymentAdapter } from '../../src/infrastructure/payments/dev.adapter';

describe('DevPaymentAdapter', () => {
  const adapter = new DevPaymentAdapter();

  describe('createPayment', () => {
    it('succeeds when amountMinor > 0', async () => {
      const result = await adapter.createPayment({
        consultationId: 'test-consultation-id',
        patientId: 'test-patient-id',
        amountMinor: 50000,
        currency: 'INR',
        idempotencyKey: 'test-key-1',
      });
      expect(result.status).toBe('SUCCEEDED');
      expect(result.providerReference).toContain('DEV-');
    });

    it('fails when amountMinor === 0', async () => {
      const result = await adapter.createPayment({
        consultationId: 'test-consultation-id',
        patientId: 'test-patient-id',
        amountMinor: 0,
        currency: 'INR',
        idempotencyKey: 'test-key-2',
      });
      expect(result.status).toBe('FAILED');
    });
  });

  describe('verifyWebhook', () => {
    const secret = 'test-webhook-secret';

    it('accepts valid HMAC signature', async () => {
      const payload = JSON.stringify({
        providerReference: 'DEV-abc12345-1234567890',
        status: 'SUCCEEDED',
      });
      const signature = DevPaymentAdapter.generateTestWebhookSignature(payload, secret);

      const result = await adapter.verifyWebhook(payload, signature, secret);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('SUCCEEDED');
    });

    it('rejects invalid HMAC signature', async () => {
      const payload = JSON.stringify({ status: 'SUCCEEDED' });
      const result = await adapter.verifyWebhook(payload, 'invalid-sig', secret);
      expect(result.valid).toBe(false);
    });

    it('rejects tampered payload', async () => {
      const payload = JSON.stringify({ status: 'SUCCEEDED' });
      const signature = DevPaymentAdapter.generateTestWebhookSignature(payload, secret);
      const tamperedPayload = JSON.stringify({ status: 'FAILED' });

      const result = await adapter.verifyWebhook(tamperedPayload, signature, secret);
      expect(result.valid).toBe(false);
    });
  });

  describe('processRefund', () => {
    it('returns a refund reference', async () => {
      const result = await adapter.processRefund({
        providerReference: 'DEV-ref-123',
        amountMinor: 50000,
        reason: 'Customer requested',
      });
      expect(result.refundReference).toContain('DEV-REFUND-');
    });
  });
});
