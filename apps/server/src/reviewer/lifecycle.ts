import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { POLICY_VERSION } from '@portl/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { OtpDelivery } from '../auth/auth.js';
import { accountProof } from '../account/proof.js';
import { reviewUnavailable } from './service.js';

export const lifecycleEmail = (email: string) =>
  email.toLowerCase().endsWith('@lifecycle.review.portl.invalid');
type Identity = NonNullable<
  Awaited<ReturnType<PrismaClient['reviewLifecycle']['findUnique']>>
>;
type Session = { user: { id: string }; session: { id: string } };
type Purpose = 'verify-current-email' | 'change-email' | 'delete-account';
export function reviewLifecycle(db: PrismaClient, secret: string) {
  const context = new AsyncLocalStorage<{
    identity: Identity;
    tx: Prisma.TransactionClient;
  }>();
  const encryptionKey = createHmac('sha256', secret)
    .update('review-lifecycle-delivery:v1')
    .digest('hex');
  const assert = (userId: string) => {
    if (context.getStore()?.identity.userId !== userId)
      throw reviewUnavailable();
  };
  const run = async <T>(
    session: Session | null,
    work: () => Promise<T>,
    exclusive = false,
  ): Promise<T> => {
    const user = session
      ? await db.user.findUnique({
          where: { id: session.user.id },
          select: { isReviewLifecycle: true },
        })
      : null;
    if (!user?.isReviewLifecycle) return work();
    const identity = await db.reviewLifecycle.findUnique({
      where: { userId: session!.user.id },
    });
    if (!identity) throw reviewUnavailable();
    return db.$transaction(
      async (tx) => {
        // Parent -> parent session. Hold through the underlying mutation and delivery.
        // Do not lock the child here: Better Auth/account services acquire their own child locks.
        const rows = exclusive
          ? await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM portl_auth."User" WHERE id=${identity.parentId} FOR UPDATE`
          : await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM portl_auth."User" WHERE id=${identity.parentId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM portl_auth."Session" WHERE id=${identity.parentSessionId} AND "userId"=${identity.parentId} FOR SHARE`;
        const [allowed] = await tx.$queryRaw<
          { allowed: boolean }[]
        >`SELECT portl_auth.lifecycle_parent_allowed(${identity.userId}) AS allowed`;
        const active = await tx.session.findFirst({
          where: {
            id: session!.session.id,
            userId: identity.userId,
            expiresAt: { gt: new Date() },
            user: { deletionRequestedAt: null },
          },
        });
        if (!rows.length || !allowed?.allowed || !active)
          throw reviewUnavailable();
        return context.run({ identity, tx }, work);
      },
      { timeout: 20_000 },
    );
  };
  return {
    run,
    assert,
    active: () => !!context.getStore(),
    assertDeletionEmail(email: string) {
      const c = context.getStore()?.identity;
      if (!c && !lifecycleEmail(email)) return;
      if (!c || c.purpose !== 'deletion' || c.originalEmail !== email)
        throw reviewUnavailable();
    },
    async prepareSession(userId: string, sessionId: string) {
      assert(userId);
      const tx = context.getStore()!.tx;
      await tx.session.deleteMany({
        where: { userId, id: { not: sessionId } },
      });
      await tx.accountPolicy.upsert({
        where: { userId },
        create: { userId, adult: true, version: POLICY_VERSION },
        update: {
          adult: true,
          version: POLICY_VERSION,
          acceptedAt: new Date(),
        },
      });
    },
    identity: (userId: string) =>
      db.reviewLifecycle.findUnique({
        where: { userId },
        select: { purpose: true, nextEmail: true, expiresAt: true },
      }),
    permits(email: string, purpose: Purpose) {
      const c = context.getStore()?.identity;
      return (
        !!c &&
        (purpose === 'change-email'
          ? c.purpose === 'email-change' && email === c.nextEmail
          : email === c.originalEmail &&
            (purpose === 'delete-account'
              ? c.purpose === 'deletion'
              : c.purpose === 'email-change'))
      );
    },
    async allocate(parent: Session, purpose: 'email-change' | 'deletion') {
      const policy = await db.accountPolicy.findUnique({
        where: { userId: parent.user.id },
      });
      if (!policy?.adult || policy.version !== POLICY_VERSION)
        throw reviewUnavailable();
      try {
        const [result] = await db.$queryRaw<
          { id: string }[]
        >`SELECT portl_auth.allocate_review_lifecycle(${parent.user.id},${parent.session.id},${purpose},${randomUUID()}) AS id`;
        if (!result) throw reviewUnavailable();
        return result.id;
      } catch {
        throw reviewUnavailable();
      }
    },
    // This transport is exclusively synthetic. Real mail never enters this store.
    async capture(message: Parameters<OtpDelivery>[0]) {
      if (!lifecycleEmail(message.email)) {
        if (context.getStore()) throw reviewUnavailable();
        return false;
      }
      const c = context.getStore();
      const purpose = message.purpose;
      if (
        !c ||
        !purpose ||
        !['verify-current-email', 'change-email', 'delete-account'].includes(
          purpose,
        )
      )
        throw reviewUnavailable();
      const p = purpose as Purpose;
      const allowed =
        p === 'change-email'
          ? c.identity.purpose === 'email-change' &&
            message.email === c.identity.nextEmail
          : message.email === c.identity.originalEmail &&
            (p === 'delete-account'
              ? c.identity.purpose === 'deletion'
              : c.identity.purpose === 'email-change');
      if (!allowed) throw reviewUnavailable();
      const cipherText = await symmetricEncrypt({
        key: encryptionKey,
        data: JSON.stringify([
          c.identity.userId,
          p,
          message.email,
          message.otp,
        ]),
      });
      await c.tx.reviewLifecycleCode.upsert({
        where: { userId_purpose: { userId: c.identity.userId, purpose: p } },
        create: {
          userId: c.identity.userId,
          purpose: p,
          email: message.email,
          cipherText,
          expiresAt: new Date(Date.now() + 300_000),
        },
        update: {
          email: message.email,
          cipherText,
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      return true;
    },
    async code(session: Session, purpose: Purpose) {
      return run(session, async () => {
        const c = context.getStore();
        if (!c) throw reviewUnavailable();
        const stored = await c.tx.reviewLifecycleCode.findUnique({
          where: { userId_purpose: { userId: session.user.id, purpose } },
        });
        if (!stored || stored.expiresAt <= new Date())
          throw reviewUnavailable();
        const [uid, p, email, otp]: unknown[] = JSON.parse(
          await symmetricDecrypt({
            key: encryptionKey,
            data: stored.cipherText,
          }),
        );
        if (
          uid !== session.user.id ||
          p !== purpose ||
          email !== stored.email ||
          typeof otp !== 'string' ||
          !/^\d{6}$/.test(otp)
        )
          throw reviewUnavailable();
        if (purpose === 'delete-account') {
          const challenge = await c.tx.deletionChallenge.findFirst({
            where: {
              userId: uid,
              email: stored.email,
              expiresAt: { gt: new Date() },
              attempts: { lt: 3 },
            },
            orderBy: { expiresAt: 'desc' },
          });
          if (
            !challenge ||
            !accountProof(secret).verify(challenge, otp, challenge.digest)
          )
            throw reviewUnavailable();
        } else {
          const identifier =
            purpose === 'change-email'
              ? `change-email-otp-${c.identity.originalEmail}-${c.identity.nextEmail}`
              : `email-verification-otp-${c.identity.originalEmail}`;
          const hash = createHmac('sha256', secret)
            .update(`otp:${otp}`)
            .digest('base64url');
          const challenge = await c.tx.verification.findUnique({
            where: { identifier },
          });
          const [digest, attempts] = challenge?.value.split(':') ?? [];
          if (
            !challenge ||
            challenge.expiresAt <= new Date() ||
            digest !== hash ||
            !attempts ||
            !/^[0-2]$/.test(attempts)
          )
            throw reviewUnavailable();
        }
        return { otp };
      });
    },
  };
}
