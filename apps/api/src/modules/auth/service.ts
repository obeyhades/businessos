import type { PrismaClient, User } from '@businessos/db';
import type {
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
} from '@businessos/types';
import type { ApiConfig } from '../../config.js';
import { errors } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/passwords.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { recordAudit } from '../audit/service.js';
import { enqueueEmail, enqueueOutbox } from '../outbox/service.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface AuthDeps {
  prisma: PrismaClient;
  config: ApiConfig;
}

export interface RequestMeta {
  ip: string;
  userAgent?: string;
}

export async function registerUser(
  { prisma }: AuthDeps,
  input: RegisterBody,
  meta: RequestMeta,
): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw errors.conflict('email_taken', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        locale: input.locale,
      },
    });
    await recordAudit(tx, {
      action: 'user.registered',
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await enqueueOutbox(tx, 'user.registered', { userId: user.id });
    return user;
  });
}

export async function verifyLogin(
  { prisma }: AuthDeps,
  input: LoginBody,
  meta: RequestMeta,
): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;

  if (!user || !valid) {
    await recordAudit(prisma, {
      action: 'user.login_failed',
      // Metadata keeps the attempted email for security review; never the password.
      metadata: { email: input.email },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    throw errors.invalidCredentials();
  }

  await recordAudit(prisma, {
    action: 'user.login',
    actorUserId: user.id,
    entityType: 'user',
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return user;
}

export async function requestPasswordReset(
  { prisma, config }: AuthDeps,
  input: ForgotPasswordBody,
  meta: RequestMeta,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Always succeed from the caller's perspective — never reveal account existence.
  if (!user) return;

  const token = generateToken();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await enqueueEmail(tx, {
      to: user.email,
      kind: 'password_reset',
      organizationId: null,
      subject: 'Reset your BusinessOS password / Återställ ditt lösenord',
      text: [
        `Hi ${user.name},`,
        '',
        'Someone (hopefully you) requested a password reset for your BusinessOS account.',
        'The link below is valid for 60 minutes:',
        '',
        `${config.APP_BASE_URL}/reset-password?token=${token}`,
        '',
        'If you did not request this, you can safely ignore this email.',
        '',
        '---',
        'Någon (förhoppningsvis du) har begärt en lösenordsåterställning för ditt BusinessOS-konto.',
        'Länken ovan är giltig i 60 minuter. Om du inte begärde detta kan du ignorera det här mejlet.',
      ].join('\n'),
    });
    await recordAudit(tx, {
      action: 'user.password_reset_requested',
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export async function resetPassword(
  { prisma }: AuthDeps,
  input: ResetPasswordBody,
  meta: RequestMeta,
): Promise<void> {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() <= Date.now()) {
    throw errors.badRequest('invalid_reset_token', 'This reset link is invalid or has expired');
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });
    // Revoke every existing session — a reset means credentials may be compromised.
    await tx.session.deleteMany({ where: { userId: resetToken.userId } });
    await recordAudit(tx, {
      action: 'user.password_reset_completed',
      actorUserId: resetToken.userId,
      entityType: 'user',
      entityId: resetToken.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}
