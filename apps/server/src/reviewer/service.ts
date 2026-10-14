import { POLICY_VERSION, type reviewerRole } from '@portl/contracts';
import type { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { DomainError } from '../registry/context.js';
import { verifyReviewerKey } from './proof.js';

export const reviewUnavailable = () =>
  new DomainError(
    401,
    'REVIEW_ACCESS_UNAVAILABLE',
    'Review access is unavailable or the key is incorrect.',
  );
export const sharedReviewAccount = () =>
  new DomainError(
    403,
    'SHARED_REVIEW_ACCOUNT',
    'This shared fictional account is managed by the operator. Use a personal account for email changes, recovery or deletion.',
  );
export async function assertReviewTarget(
  tx: Prisma.TransactionClient,
  societyId: string,
  email: string,
  role: string,
) {
  const [result] = await tx.$queryRaw<
    { allowed: boolean }[]
  >`SELECT portl_auth.reviewer_target_allowed(${societyId},${email},${role}) AS allowed`;
  if (!result?.allowed)
    throw new DomainError(
      422,
      'TARGET_UNAVAILABLE',
      'This account is unavailable for the selected role and society.',
    );
}

type Credential = { userId: string; generation: number; keyHash: string };
export function reviewerService(db: PrismaClient, secret: string) {
  const lock = async (
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
  ) => {
    // Same User -> Session ordering as revocation, deletion and owner rotation.
    const active = await tx.$queryRaw<
      { id: string }[]
    >`SELECT u.id FROM portl_auth."User" u JOIN portl_auth."Session" s ON s."userId"=u.id WHERE u.id=${userId} AND s.id=${sessionId} AND u."isReviewer" AND u."deletionRequestedAt" IS NULL AND s."expiresAt">clock_timestamp() FOR SHARE OF u,s`;
    if (!active.length) throw reviewUnavailable();
    // Operator metadata changes acquire this same User lock first; runtime has no metadata UPDATE privilege.
    const account = await tx.reviewerAccount.findUnique({
      where: { userId },
      include: { realm: true },
    });
    if (!account?.enabled || !account.realm.enabled) throw reviewUnavailable();
    return account;
  };
  return {
    async identity(userId: string) {
      const account = await db.reviewerAccount.findUnique({
        where: { userId },
        select: { role: true, realm: { select: { societyId: true } } },
      });
      return account
        ? { societyId: account.realm.societyId, role: account.role }
        : null;
    },
    async allowed(userId: string, sessionId: string) {
      const [result] = await db.$queryRaw<
        { allowed: boolean }[]
      >`SELECT portl_auth.reviewer_session_allowed(${userId},${sessionId}) AS allowed`;
      return !!result?.allowed;
    },
    async credential(
      role: z.infer<typeof reviewerRole>,
      key: string,
    ): Promise<Credential> {
      const account = await db.reviewerAccount.findUnique({
        where: { realmId_role: { realmId: 'play-review', role } },
        include: { realm: true, user: true },
      });
      const verified = verifyReviewerKey(
        secret,
        account?.userId ?? 'unavailable',
        key,
        account?.keyHash ?? '0'.repeat(64),
      );
      if (
        !verified ||
        !account?.enabled ||
        !account.realm.enabled ||
        !account.user.isReviewer ||
        account.user.deletionRequestedAt
      )
        throw reviewUnavailable();
      return {
        userId: account.userId,
        generation: account.generation,
        keyHash: account.keyHash,
      };
    },
    async finishSignIn(credential: Credential, sessionId: string) {
      return db.$transaction(
        async (tx) => {
          const account = await lock(tx, credential.userId, sessionId);
          if (
            account.generation !== credential.generation ||
            account.keyHash !== credential.keyHash
          )
            throw reviewUnavailable();
          await tx.reviewerSession.create({
            data: {
              sessionId,
              userId: credential.userId,
              generation: account.generation,
            },
          });
          await tx.accountPolicy.upsert({
            where: { userId: credential.userId },
            create: {
              userId: credential.userId,
              adult: true,
              version: POLICY_VERSION,
            },
            update: {
              adult: true,
              version: POLICY_VERSION,
              acceptedAt: new Date(),
            },
          });
          if (account.role === 'ADMIN')
            await tx.adminAssurance.create({
              data: {
                sessionId,
                expiresAt: new Date(Date.now() + 15 * 60_000),
              },
            });
        },
        { timeout: 15_000 },
      );
    },
    async reauthenticate(userId: string, sessionId: string, key: string) {
      return db.$transaction(
        async (tx) => {
          const account = await lock(tx, userId, sessionId);
          const marker = await tx.reviewerSession.findUnique({
            where: { sessionId },
          });
          const policy = await tx.accountPolicy.findUnique({
            where: { userId },
          });
          if (
            account.role !== 'ADMIN' ||
            marker?.userId !== userId ||
            marker.generation !== account.generation ||
            policy?.version !== POLICY_VERSION ||
            !policy.adult ||
            !verifyReviewerKey(secret, userId, key, account.keyHash)
          )
            throw reviewUnavailable();
          await tx.adminAssurance.upsert({
            where: { sessionId },
            create: {
              sessionId,
              expiresAt: new Date(Date.now() + 15 * 60_000),
            },
            update: { expiresAt: new Date(Date.now() + 15 * 60_000) },
          });
          return { success: true as const };
        },
        { timeout: 15_000 },
      );
    },
  };
}
