/**
 * Development-only payment adapter.
 *
 * IMPORTANT: This adapter NEVER processes real money.
 * It produces deterministic, simulated outcomes for testing.
 *
 * Behavior:
 * - amountMinor > 0  → SUCCEEDED (payment confirmed)
 * - amountMinor === 0 → FAILED (simulated failure)
 * - providerReference follows format: DEV-{consultationId-prefix}-{timestamp}
 *
 * Webhook verification uses HMAC-SHA256 matching the real Razorpay pattern.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import { verifyHmacSignature, computeHmacSignature } from '../../common/utils/crypto';
import type {
  PaymentProvider,
  CreatePaymentParams,
  PaymentResult,
  WebhookVerificationResult,
  RefundParams,
} from './payment.provider';

export class DevPaymentAdapter implements PaymentProvider {
  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    const providerReference = `DEV-${params.consultationId.slice(0, 8)}-${Date.now()}`;

    // Deterministic: amount > 0 succeeds, amount === 0 fails
    const succeeds = params.amountMinor > 0;

    logger.info(
      {
        provider: 'DEV',
        providerReference,
        amountMinor: params.amountMinor,
        currency: params.currency,
        outcome: succeeds ? 'SUCCEEDED' : 'FAILED',
        note: '[DEV-ONLY] No real money has been transferred',
      },
      'Dev payment adapter: createPayment',
    );

    return {
      providerReference,
      status: succeeds ? 'SUCCEEDED' : 'FAILED',
      metadata: { devAdapter: true, note: 'No real money transferred' },
    };
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentResult> {
    const isSucceeded = !providerReference.includes('FAIL');
    return {
      providerReference,
      status: isSucceeded ? 'SUCCEEDED' : 'FAILED',
    };
  }

  async verifyWebhook(
    rawBody: string,
    signature: string,
    secret: string,
  ): Promise<WebhookVerificationResult> {
    // Use HMAC-SHA256 verification matching real provider pattern
    const valid = verifyHmacSignature(secret, rawBody, signature);

    if (!valid) {
      return { valid: false };
    }

    let parsed: { providerReference?: string; status?: string; failureReasonCode?: string };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      return { valid: false };
    }

    return {
      valid: true,
      providerReference: parsed.providerReference,
      status: parsed.status as 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | undefined,
      failureReasonCode: parsed.failureReasonCode,
    };
  }

  async processRefund(params: RefundParams): Promise<{ refundReference: string }> {
    const refundReference = `DEV-REFUND-${uuidv4().slice(0, 8)}`;
    logger.info(
      {
        provider: 'DEV',
        refundReference,
        providerReference: params.providerReference,
        amountMinor: params.amountMinor,
        note: '[DEV-ONLY] No real refund processed',
      },
      'Dev payment adapter: processRefund',
    );
    return { refundReference };
  }

  /**
   * Helper for tests: generate a valid dev webhook signature
   */
  static generateTestWebhookSignature(payload: string, secret: string): string {
    return computeHmacSignature(secret, payload);
  }
}
