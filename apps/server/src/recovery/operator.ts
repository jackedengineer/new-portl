import { randomUUID, randomBytes, randomInt } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';
import {
  emailSchema,
  idSchema,
  POLICY_VERSION,
  recoveryOperation,
} from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { OtpDelivery } from '../auth/auth.js';
import { hash } from '../registry/context.js';
import { recoveryEmailProof } from './proof.js';

export const operatorRecoveryInput = z
  .strictObject({
    operation: recoveryOperation,
    targetEmail: emailSchema,
    societyId: idSchema.optional(),
    operatorId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{3,80}$/),
    evidenceRef: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{3,100}$/),
    identityVerified: z.literal(true),
    societyAuthorityVerified: z.literal(true),
  })
  .superRefine((input, ctx) => {
    if ((input.operation === 'RESTORE_ADMIN') !== !!input.societyId)
      ctx.addIssue({
        code: 'custom',
        message: 'Only restoration requires a society ID',
      });
  });
const cleared = {
  otpHash: null,
  encryptedSecret: null,
  expectedFactorHash: null,
};
export async function assertRecoveryOperator(db: PrismaClient) {
  const [role] = await db.$queryRaw<
    { allowed: boolean }[]
  >`SELECT count(*)=3 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='portl_auth' AND c.relname IN ('User','OperatorRecovery')) OR (n.nspname='portl_registry' AND c.relname='Membership')`;
  if (!role?.allowed)
    throw new Error('Recovery requires the migration-owner connection');
}
export async function prepareRecovery(
  db: PrismaClient,
  secret: string,
  raw: unknown,
  deliver: OtpDelivery,
) {
  const input = operatorRecoveryInput.parse(raw);
  await assertRecoveryOperator(db);
  const id = randomUUID(),
    otp = String(randomInt(0, 1_000_000)).padStart(6, '0'),
    newSecret = randomBytes(32).toString('hex');
  const encryptedSecret = await symmetricEncrypt({
    key: secret,
    data: newSecret,
  });
  const result = await db.$transaction(
    async (tx) => {
      const [user] = await tx.$queryRaw<
        { id: string; email: string }[]
      >`SELECT u.id,u.email FROM portl_auth."User" u JOIN portl_auth."AccountPolicy" p ON p."userId"=u.id WHERE u.email=${input.targetEmail} AND NOT u."isReviewer" AND u."emailVerified" AND u."deletionRequestedAt" IS NULL AND p.adult AND p.version=${POLICY_VERSION} FOR UPDATE OF u`;
      if (!user)
        throw new Error(
          'Target must sign in and accept the current adult-account policy first',
        );
      if (input.operation === 'RESTORE_ADMIN') {
        const societies = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM portl_registry."Society" WHERE id=${input.societyId!} AND NOT archived FOR UPDATE`;
        const admins = await tx.membership.count({
          where: {
            societyId: input.societyId!,
            role: 'ADMIN',
            active: true,
            user: { deletionRequestedAt: null },
          },
        });
        if (!societies.length || admins)
          throw new Error(
            'Restoration requires an available society with no active admin',
          );
      } else if (
        !(await tx.membership.count({
          where: {
            userId: user.id,
            role: 'ADMIN',
            active: true,
            society: { archived: false },
          },
        }))
      )
        throw new Error('Authenticator recovery requires an active admin');
      const now = new Date();
      if (
        (await tx.operatorRecovery.count({
          where: {
            userId: user.id,
            createdAt: { gt: new Date(now.getTime() - 60000) },
          },
        })) ||
        (await tx.operatorRecovery.count({
          where: {
            userId: user.id,
            createdAt: { gt: new Date(now.getTime() - 3600000) },
          },
        })) >= 5
      )
        throw new Error('Wait before preparing another recovery request');
      await tx.operatorRecovery.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: now, ...cleared },
      });
      const current = await tx.twoFactor.findUnique({
        where: { userId: user.id },
        select: { secret: true },
      });
      await tx.operatorRecovery.create({
        data: {
          id,
          userId: user.id,
          email: user.email,
          operation: input.operation,
          societyId: input.societyId ?? null,
          operatorId: input.operatorId,
          evidenceRef: input.evidenceRef,
          otpHash: recoveryEmailProof(secret, id, user.id, user.email, otp),
          encryptedSecret,
          expectedFactorHash: hash(current?.secret ?? ''),
          expiresAt: new Date(now.getTime() + 300000),
        },
      });
      return { id, expiresAt: new Date(now.getTime() + 300000).toISOString() };
    },
    { timeout: 15000 },
  );
  try {
    await deliver({ email: input.targetEmail, otp, purpose: 'admin-recovery' });
  } catch {
    await db.operatorRecovery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED', completedAt: new Date(), ...cleared },
    });
    throw new Error('Recovery email failed; this request was cancelled');
  }
  return result;
}
export async function recoveryStatus(db: PrismaClient, id: string) {
  z.uuid().parse(id);
  await assertRecoveryOperator(db);
  const row = await db.operatorRecovery.findUnique({
    where: { id },
    select: {
      id: true,
      operation: true,
      status: true,
      expiresAt: true,
      completedAt: true,
      attempts: true,
      operatorId: true,
      evidenceRef: true,
    },
  });
  if (!row) throw new Error('Recovery request not found');
  return row;
}
export async function cancelRecovery(db: PrismaClient, id: string) {
  z.uuid().parse(id);
  await assertRecoveryOperator(db);
  await db.operatorRecovery.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'CANCELLED', completedAt: new Date(), ...cleared },
  });
  return recoveryStatus(db, id);
}
