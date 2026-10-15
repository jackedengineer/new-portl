import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { POLICY_VERSION, type deletionProofInput } from '@portl/contracts';
import type { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { OtpDelivery } from '../auth/auth.js';
import { DomainError } from '../registry/context.js';
import type { AccountProof } from './proof.js';

const invalidProof = () =>
  new DomainError(
    400,
    'INVALID_DELETION_CODE',
    'This deletion code is invalid or expired. Request a new code.',
  );
const unavailable = () =>
  new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
export function accountService(
  db: PrismaClient,
  proof: AccountProof,
  deliver: OtpDelivery,
  assertLifecycle: (userId: string) => void = () => {
    throw unavailable();
  },
  lifecycleRequest: () => boolean = () => false,
) {
  return {
    async accept(userId: string, sessionId: string) {
      return db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT u.id FROM portl_auth."User" u JOIN portl_auth."Session" s ON s."userId"=u.id WHERE u.id=${userId} AND s.id=${sessionId} AND s."expiresAt">clock_timestamp() AND u."deletionRequestedAt" IS NULL FOR SHARE OF u,s`;
        if (!rows.length) throw unavailable();
        await tx.accountPolicy.upsert({
          where: { userId },
          create: { userId, version: POLICY_VERSION, adult: true },
          update: {
            version: POLICY_VERSION,
            adult: true,
            acceptedAt: new Date(),
          },
        });
        return { success: true };
      });
    },
    async startDeletion(email: string) {
      const id = randomUUID(),
        receiptToken = randomBytes(32).toString('hex');
      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const challenge = await db.$transaction(async (tx) => {
        const users = await tx.$queryRaw<
          { id: string; isReviewLifecycle: boolean }[]
        >`SELECT id,"isReviewLifecycle" FROM portl_auth."User" WHERE email=${email} AND NOT "isReviewer" AND "emailVerified" AND "deletionRequestedAt" IS NULL FOR UPDATE`;
        const user = users[0];
        if (!user) return null;
        if (user.isReviewLifecycle || lifecycleRequest())
          assertLifecycle(user.id);
        const data = { id, userId: user.id, email };
        await tx.deletionChallenge.deleteMany({
          where: { userId: user.id, expiresAt: { lt: new Date() } },
        });
        // Sending a new challenge rotates earlier codes for this account.
        await tx.deletionChallenge.updateMany({
          where: { userId: user.id },
          data: { attempts: 3 },
        });
        return tx.deletionChallenge.create({
          data: {
            ...data,
            digest: proof.digest(data, otp),
            receiptHash: proof.receipt(receiptToken),
            expiresAt: new Date(Date.now() + 300_000),
          },
        });
      });
      if (challenge) {
        try {
          await deliver({ email, otp, purpose: 'delete-account' });
        } catch {
          await db.deletionChallenge.deleteMany({
            where: { id, digest: challenge.digest },
          });
          // Same public outcome as an unknown address; no live challenge survives failed delivery.
        }
      }
      return { challengeId: id, receiptToken, expiresIn: 300 as const };
    },
    async confirmDeletion(input: z.infer<typeof deletionProofInput>) {
      const receiptHash = proof.receipt(input.receiptToken);
      const result = await db.$transaction(
        async (tx) => {
          const prior = await tx.accountDeletion.findUnique({
            where: { receiptHash },
          });
          if (prior && prior.id === input.challengeId) return prior;
          const candidate = await tx.deletionChallenge.findFirst({
            where: { id: input.challengeId, receiptHash },
          });
          if (!candidate) return null;
          const subject = await tx.user.findUnique({
            where: { id: candidate.userId },
            select: { isReviewLifecycle: true },
          });
          if (subject?.isReviewLifecycle || lifecycleRequest())
            assertLifecycle(candidate.userId);
          // All challenge mutations lock User first (send, confirm, email change).
          await tx.$queryRaw`SELECT id FROM portl_auth."User" WHERE id=${candidate.userId} FOR UPDATE`;
          const already = await tx.accountDeletion.findUnique({
            where: { receiptHash },
          });
          if (already && already.id === input.challengeId) return already;
          const rows = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM portl_auth."DeletionChallenge" WHERE id=${input.challengeId} AND "receiptHash"=${receiptHash} FOR UPDATE`;
          if (!rows.length) return null;
          // A concurrent confirmation may have committed while this row lock waited.
          const committed = await tx.accountDeletion.findUnique({
            where: { receiptHash },
          });
          if (committed && committed.id === input.challengeId) return committed;
          const challenge = await tx.deletionChallenge.findUniqueOrThrow({
            where: { id: input.challengeId },
          });
          if (challenge.expiresAt <= new Date() || challenge.attempts >= 3)
            return null;
          await tx.deletionChallenge.update({
            where: { id: challenge.id },
            data: { attempts: challenge.attempts + 1 },
          });
          if (
            !proof.verify(challenge, input.otp, challenge.digest) ||
            (input.expectedUserId && input.expectedUserId !== challenge.userId)
          )
            return null;
          const users = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM portl_auth."User" WHERE id=${challenge.userId} AND email=${challenge.email} AND "deletionRequestedAt" IS NULL FOR UPDATE`;
          if (!users.length) return null;
          await tx.user.update({
            where: { id: challenge.userId },
            data: { deletionRequestedAt: new Date() },
          });
          const deletion = await tx.accountDeletion.create({
            data: {
              id: challenge.id,
              userId: challenge.userId,
              subjectHash: proof.subject(challenge.userId),
              emailHash: proof.email(challenge.email),
              receiptHash,
            },
          });
          await tx.$executeRaw`SELECT portl_auth.revoke_account_devices(${challenge.userId})`;
          await tx.session.deleteMany({ where: { userId: challenge.userId } });
          return deletion;
        },
        { timeout: 15_000 },
      );
      if (!result) throw invalidProof();
      return {
        status: result.status,
        requestedAt: result.requestedAt.toISOString(),
        completedAt: result.completedAt?.toISOString() ?? null,
      };
    },
    async deletionStatus(receiptToken: string) {
      const result = await db.accountDeletion.findUnique({
        where: { receiptHash: proof.receipt(receiptToken) },
      });
      if (!result)
        throw new DomainError(
          404,
          'NOT_FOUND',
          'No deletion receipt found. Check the receipt or contact support.',
        );
      return {
        status: result.status,
        requestedAt: result.requestedAt.toISOString(),
        completedAt: result.completedAt?.toISOString() ?? null,
      };
    },
    async sessions(userId: string, current: string) {
      const rows = await db.session.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        select: { id: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return {
        items: rows.map((r) => ({
          ...r,
          current: r.id === current,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
        })),
      };
    },
    async revoke(userId: string, currentSession: string, sessionId: string) {
      await db.$transaction(async (tx) => {
        const users = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM portl_auth."User" WHERE id=${userId} AND "deletionRequestedAt" IS NULL FOR UPDATE`;
        const current = await tx.session.findFirst({
          where: { id: currentSession, userId, expiresAt: { gt: new Date() } },
        });
        if (!users.length || !current) throw unavailable();
        await tx.$executeRaw`SELECT set_config('portl.session_id',${currentSession},true)`;
        await tx.$executeRaw`SELECT portl_auth.revoke_session_devices(${userId},${sessionId})`;
        await tx.session.deleteMany({ where: { id: sessionId, userId } });
      });
      return { success: true };
    },
  };
}
