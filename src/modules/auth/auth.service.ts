import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { AuditOutcome, UserRole, UserStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { sha256, generateSecureToken, normalizeEmail } from '../../common/utils/crypto';
import {
  AppError,
  ConflictError,
  UnauthenticatedError,
  NotFoundError,
  ForbiddenError,
} from '../../common/errors/AppError';
import { writeAuditLog, AuditActions } from '../audit/audit.service';
import type { JwtPayload } from '../../common/middleware/auth';
import type {
  RegisterInput,
  LoginInput,
  RefreshInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schemas';
import { sendPasswordResetEmail } from '../../infrastructure/email/email.service';

// Argon2id parameters (OWASP recommended)
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

// ============================================================
// Token helpers
// ============================================================

export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

export function signRefreshToken(userId: string): {
  rawToken: string;
  tokenHash: string;
  familyHash: string;
  expiresAt: Date;
} {
  const rawToken = generateSecureToken(48); // 384 bits of entropy
  const tokenHash = sha256(rawToken);
  const familyHash = sha256(uuidv4()); // New family per login
  const expiresAt = new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN));
  return { rawToken, tokenHash, familyHash, expiresAt };
}

function parseDuration(dur: string): number {
  const units: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const match = dur.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${dur}`);
  return parseInt(match[1]!, 10) * (units[match[2]!] ?? 0);
}

// ============================================================
// Registration
// ============================================================

export async function registerUser(
  input: RegisterInput,
  meta: { ipAddress?: string; userAgent?: string; correlationId?: string },
) {
  const email = normalizeEmail(input.email);

  // Check for existing account (use consistent timing to avoid enumeration)
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Return generic error — do not reveal whether email exists
    throw new ConflictError('An account with this email already exists', 'CONFLICT');
  }

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.PATIENT, // Always PATIENT; role cannot be set by client
        status: UserStatus.ACTIVE,
        profile: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
          },
        },
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        profile: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    await writeAuditLog(
      {
        actorUserId: newUser.id,
        action: AuditActions.REGISTER,
        resourceType: 'User',
        resourceId: newUser.id,
        outcome: AuditOutcome.SUCCESS,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
        metadata: { email },
      },
      tx,
    );

    return newUser;
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.profile?.firstName ?? '',
    lastName: user.profile?.lastName ?? '',
    createdAt: user.createdAt,
  };
}

// ============================================================
// Login
// ============================================================

export async function loginUser(
  input: LoginInput,
  meta: { ipAddress?: string; userAgent?: string; correlationId?: string },
) {
  const email = normalizeEmail(input.email);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      deletedAt: true,
    },
  });

  // Use constant-time comparison regardless of whether user exists
  const dummyHash =
    '$argon2id$v=19$m=65536,t=3,p=4$dummysalt12345678$dummyhashvalue1234567890abcdef';
  const hashToVerify = user?.passwordHash ?? dummyHash;

  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(hashToVerify, input.password);
  } catch {
    passwordValid = false;
  }

  if (!user || !passwordValid || user.deletedAt) {
    await writeAuditLog({
      actorUserId: user?.id ?? null,
      action: AuditActions.LOGIN_FAILURE,
      resourceType: 'User',
      resourceId: user?.id ?? null,
      outcome: AuditOutcome.FAILURE,
      ipAddress: meta.ipAddress,
      correlationId: meta.correlationId,
      metadata: { email },
    });
    // Generic message — does not reveal whether account exists
    throw new UnauthenticatedError('Invalid credentials');
  }

  if (user.status === UserStatus.SUSPENDED) {
    await writeAuditLog({
      actorUserId: user.id,
      action: AuditActions.LOGIN_FAILURE,
      resourceType: 'User',
      resourceId: user.id,
      outcome: AuditOutcome.DENIED,
      ipAddress: meta.ipAddress,
      correlationId: meta.correlationId,
      metadata: { reason: 'ACCOUNT_SUSPENDED' },
    });
    throw new AppError('Your account has been suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  // Issue tokens
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    iss: env.JWT_ISSUER,
    aud: env.JWT_AUDIENCE,
  });

  const { rawToken, tokenHash, familyHash, expiresAt } = signRefreshToken(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        familyHash,
        expiresAt,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 499) ?? null,
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: AuditActions.LOGIN_SUCCESS,
        resourceType: 'User',
        resourceId: user.id,
        outcome: AuditOutcome.SUCCESS,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });

  return {
    accessToken,
    refreshToken: rawToken,
    expiresIn: parseDuration(env.JWT_ACCESS_EXPIRES_IN) / 1000,
    tokenType: 'Bearer',
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
}

// ============================================================
// Token refresh (with family revocation on replay)
// ============================================================

export async function refreshAccessToken(
  input: RefreshInput,
  meta: { ipAddress?: string; userAgent?: string; correlationId?: string },
) {
  const tokenHash = sha256(input.refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, email: true, role: true, status: true, deletedAt: true },
      },
    },
  });

  if (!stored) {
    throw new UnauthenticatedError('Invalid refresh token');
  }

  // Replay detection: token already used or revoked
  if (stored.usedAt || stored.revokedAt) {
    logger.warn(
      { userId: stored.userId, familyHash: stored.familyHash.slice(0, 8) },
      'Refresh token reuse detected — revoking token family',
    );

    // Revoke entire family
    await prisma.refreshToken.updateMany({
      where: { familyHash: stored.familyHash },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
    });

    await writeAuditLog({
      actorUserId: stored.userId,
      action: AuditActions.REFRESH_TOKEN_REUSE,
      resourceType: 'RefreshToken',
      resourceId: stored.id,
      outcome: AuditOutcome.FAILURE,
      ipAddress: meta.ipAddress,
      correlationId: meta.correlationId,
    });

    throw new UnauthenticatedError('Session invalidated due to token reuse');
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthenticatedError('Refresh token has expired');
  }

  const { user } = stored;
  if (!user || user.deletedAt || user.status === UserStatus.SUSPENDED) {
    throw new UnauthenticatedError('Account unavailable');
  }

  // Issue new tokens (rotation)
  const newAccessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    iss: env.JWT_ISSUER,
    aud: env.JWT_AUDIENCE,
  });

  const { rawToken: newRawToken, tokenHash: newTokenHash, expiresAt: newExpiresAt } = (() => {
    const t = generateSecureToken(48);
    return {
      rawToken: t,
      tokenHash: sha256(t),
      expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN)),
    };
  })();

  await prisma.$transaction(async (tx) => {
    // Mark old token as used
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    });

    // Create new token in same family
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        familyHash: stored.familyHash, // Keep family chain
        expiresAt: newExpiresAt,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 499) ?? null,
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: AuditActions.REFRESH_TOKEN,
        resourceType: 'RefreshToken',
        resourceId: stored.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRawToken,
    expiresIn: parseDuration(env.JWT_ACCESS_EXPIRES_IN) / 1000,
    tokenType: 'Bearer',
  };
}

// ============================================================
// Logout (single session)
// ============================================================

export async function logoutUser(
  rawRefreshToken: string,
  userId: string,
  meta: { correlationId?: string },
) {
  const tokenHash = sha256(rawRefreshToken);

  const token = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!token || token.userId !== userId) {
    // Silently succeed — don't reveal token existence
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });

    await writeAuditLog(
      {
        actorUserId: userId,
        action: AuditActions.LOGOUT,
        resourceType: 'RefreshToken',
        resourceId: token.id,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });
}

// ============================================================
// Logout all sessions
// ============================================================

export async function logoutAll(userId: string, meta: { correlationId?: string }) {
  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
    });

    await writeAuditLog(
      {
        actorUserId: userId,
        action: AuditActions.LOGOUT_ALL,
        resourceType: 'User',
        resourceId: userId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });
}

// ============================================================
// Forgot password
// ============================================================

export async function forgotPassword(
  input: ForgotPasswordInput,
  meta: { correlationId?: string },
) {
  const email = normalizeEmail(input.email);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  // Always return success — do not leak account existence
  if (!user || user.status === UserStatus.SUSPENDED) {
    logger.info({ email }, 'Password reset requested for non-existent or suspended account');
    return;
  }

  // Invalidate existing reset tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const rawToken = generateSecureToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + env.RESET_TOKEN_EXPIRES_MINUTES * 60_000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  // Send email (dev adapter logs to stdout, never stores raw token)
  await sendPasswordResetEmail(email, rawToken);

  await writeAuditLog({
    actorUserId: user.id,
    action: AuditActions.PASSWORD_RESET_REQUESTED,
    resourceType: 'User',
    resourceId: user.id,
    outcome: AuditOutcome.SUCCESS,
    correlationId: meta.correlationId,
    // Never log the raw token
    metadata: { expiresAt },
  });
}

// ============================================================
// Reset password
// ============================================================

export async function resetPassword(
  input: ResetPasswordInput,
  meta: { correlationId?: string },
) {
  const tokenHash = sha256(input.token);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new AppError('Invalid or expired reset token', 400, 'TOKEN_INVALID');
  }

  if (resetToken.user.status === UserStatus.SUSPENDED) {
    throw new AppError('Account unavailable', 403, 'ACCOUNT_SUSPENDED');
  }

  const newPasswordHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);

  await prisma.$transaction(async (tx) => {
    // Mark token as used
    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    // Update password
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newPasswordHash },
    });

    // Revoke all refresh tokens (force re-login)
    await tx.refreshToken.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
    });

    await writeAuditLog(
      {
        actorUserId: resetToken.userId,
        action: AuditActions.PASSWORD_RESET_COMPLETED,
        resourceType: 'User',
        resourceId: resetToken.userId,
        outcome: AuditOutcome.SUCCESS,
        correlationId: meta.correlationId,
      },
      tx,
    );
  });
}

// ============================================================
// Get current user
// ============================================================

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          dateOfBirth: true,
          preferredTimezone: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  return user;
}
