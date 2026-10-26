// Payment provider interface — decouples business logic from provider implementation

export interface CreatePaymentParams {
  consultationId: string;
  patientId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  providerReference: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  metadata?: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  valid: boolean;
  providerReference?: string;
  status?: 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  failureReasonCode?: string;
}

export interface RefundParams {
  providerReference: string;
  amountMinor: number;
  reason: string;
}

export interface PaymentProvider {
  /**
   * Initiates a payment. Must be idempotent on providerReference.
   */
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;

  /**
   * Checks current payment status from provider.
   */
  getPaymentStatus(providerReference: string): Promise<PaymentResult>;

  /**
   * Verifies a webhook payload and extracts the event.
   */
  verifyWebhook(
    rawBody: string,
    signature: string,
    secret: string,
  ): Promise<WebhookVerificationResult>;

  /**
   * Initiates a refund.
   */
  processRefund(params: RefundParams): Promise<{ refundReference: string }>;
}
