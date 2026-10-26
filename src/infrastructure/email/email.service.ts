import { logger } from '../../config/logger';
import { env } from '../../config/env';

export interface EmailProvider {
  sendPasswordReset(to: string, token: string): Promise<void>;
  sendEmailVerification(to: string, token: string): Promise<void>;
}

class ConsoleEmailAdapter implements EmailProvider {
  async sendPasswordReset(to: string, token: string): Promise<void> {
    const resetUrl = `${env.API_BASE_URL}/api/v1/auth/reset-password?token=${token}`;
    logger.info(
      {
        to,
        // Development only — logs reset URL. Never do this in production.
        devResetUrl: resetUrl,
        note: 'DEV-ONLY: This URL contains a sensitive token. Never log in production.',
      },
      '[DEV EMAIL] Password reset link',
    );
  }

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const verifyUrl = `${env.API_BASE_URL}/api/v1/auth/verify-email?token=${token}`;
    logger.info(
      { to, devVerifyUrl: verifyUrl },
      '[DEV EMAIL] Email verification link',
    );
  }
}

// Factory — swap for SMTP adapter when EMAIL_PROVIDER=smtp
function createEmailAdapter(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'smtp') {
    // Placeholder for SMTP — not implemented in development adapter
    logger.warn('SMTP email provider configured but not yet implemented; falling back to console');
  }
  return new ConsoleEmailAdapter();
}

const emailAdapter = createEmailAdapter();

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  await emailAdapter.sendPasswordReset(to, token);
}

export async function sendEmailVerificationEmail(to: string, token: string): Promise<void> {
  await emailAdapter.sendEmailVerification(to, token);
}
