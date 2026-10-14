import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient, SocietyRole } from '../generated/prisma/client.js';
import { reviewerKeyHash } from './proof.js';

export async function assertReviewOperator(db: PrismaClient) {
  const [row] = await db.$queryRaw<
    { allowed: boolean }[]
  >`SELECT count(*)=4 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AND (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portl_auth' AND c.relname IN ('User','ReviewRealm','ReviewerAccount','ReviewerSession')`;
  if (!row?.allowed)
    throw new Error(
      'Review operations require the migration owner with RLS bypass',
    );
}
export async function createReviewRealm(db: PrismaClient, secret: string) {
  await assertReviewOperator(db);
  const societyId = randomUUID(),
    prefix = randomUUID();
  const credentials = (['RESIDENT', 'GUARD', 'ADMIN'] as const).map((role) => ({
    role,
    userId: randomUUID(),
    email: `${prefix}-${role.toLowerCase()}@review.portl.invalid`,
    accessKey: randomBytes(32).toString('base64url'),
  }));
  await db.$transaction(
    async (tx) => {
      // A singleton key rejects concurrent/repeated provisioning atomically.
      await tx.society.create({
        data: {
          id: societyId,
          name: 'Portl Review Gardens — fictional',
          joinCodeHash: randomBytes(32).toString('hex'),
          isDemo: true,
        },
      });
      await tx.reviewRealm.create({ data: { societyId, enabled: false } });
      for (const account of credentials) {
        await tx.user.create({
          data: {
            id: account.userId,
            email: account.email,
            name: `Review ${account.role.toLowerCase()}`,
            emailVerified: true,
            isReviewer: true,
          },
        });
        await tx.reviewerAccount.create({
          data: {
            userId: account.userId,
            role: account.role,
            realmId: 'play-review',
            keyHash: reviewerKeyHash(secret, account.userId, account.accessKey),
          },
        });
      }
      // Invariants require an enabled realm while provisioning its grants. It stays
      // disabled outside this transaction until the private key file is durable.
      await tx.reviewRealm.update({
        where: { id: 'play-review' },
        data: { enabled: true },
      });
      for (const account of credentials)
        await tx.membership.create({
          data: { societyId, userId: account.userId, role: account.role },
        });
      let occupiedFlat = '';
      for (const name of ['A', 'B']) {
        const tower = await tx.tower.create({ data: { societyId, name } });
        for (const label of ['101', '102']) {
          const flat = await tx.flat.create({
            data: { societyId, towerId: tower.id, label },
          });
          if (!occupiedFlat) occupiedFlat = flat.id;
        }
      }
      const admin = credentials.find((c) => c.role === 'ADMIN')!,
        resident = credentials.find((c) => c.role === 'RESIDENT')!,
        guard = credentials.find((c) => c.role === 'GUARD')!;
      await tx.occupancy.create({
        data: {
          societyId,
          flatId: occupiedFlat,
          userId: resident.userId,
          relationship: 'OWNER',
        },
      });
      const gate = await tx.gate.create({
        data: { societyId, name: 'Fictional main gate' },
      });
      await tx.guardAssignment.create({
        data: {
          societyId,
          gateId: gate.id,
          userId: guard.userId,
          createdBy: admin.userId,
        },
      });
      await tx.directoryEntry.create({
        data: {
          societyId,
          name: 'Fictional maintenance team',
          kind: 'STAFF',
          service: 'Maintenance',
          description: 'Demonstration entry. No real contact information.',
        },
      });
      const noticeId = randomUUID();
      await tx.notice.create({
        data: {
          id: noticeId,
          societyId,
          title: 'Welcome to the fictional review society',
          body: 'Use fictional data only. Sign in as guard to register a visitor for A 101, then as resident to approve or reject. Return as guard to record entry and exit. Admins can publish notices and manage the fictional directory.',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdBy: admin.userId,
        },
      });
      await tx.noticePublication.create({ data: { noticeId } });
      await tx.reviewRealm.update({
        where: { id: 'play-review' },
        data: { enabled: false },
      });
    },
    { timeout: 30_000 },
  );
  return { societyId, credentials };
}

export async function setReviewRealmEnabled(
  db: PrismaClient,
  enabled: boolean,
) {
  await assertReviewOperator(db);
  await db.$transaction(
    async (tx) => {
      // All changes take User first in a stable order, matching sign-in/domain work.
      await tx.$queryRaw`SELECT u.id FROM portl_auth."User" u JOIN portl_auth."ReviewerAccount" a ON a."userId"=u.id WHERE a."realmId"='play-review' ORDER BY u.id FOR UPDATE OF u`;
      await tx.reviewRealm.update({
        where: { id: 'play-review' },
        data: { enabled },
      });
      const accounts = await tx.reviewerAccount.findMany({
        where: { realmId: 'play-review' },
      });
      for (const account of accounts) {
        await tx.session.deleteMany({ where: { userId: account.userId } });
        await tx.pushDevice.updateMany({
          where: { userId: account.userId },
          data: { enabled: false },
        });
      }
    },
    { timeout: 15_000 },
  );
}

export async function rotateReviewKey(
  db: PrismaClient,
  secret: string,
  role: SocietyRole,
) {
  await assertReviewOperator(db);
  const accessKey = randomBytes(32).toString('base64url');
  const account = await db.$transaction(
    async (tx) => {
      const candidate = await tx.reviewerAccount.findUniqueOrThrow({
        where: { realmId_role: { realmId: 'play-review', role } },
      });
      await tx.$queryRaw`SELECT id FROM portl_auth."User" WHERE id=${candidate.userId} FOR UPDATE`;
      const current = await tx.reviewerAccount.findUniqueOrThrow({
        where: { userId: candidate.userId },
      });
      await tx.reviewerAccount.update({
        where: { userId: current.userId },
        data: {
          keyHash: reviewerKeyHash(secret, current.userId, accessKey),
          generation: current.generation + 1,
        },
      });
      await tx.session.deleteMany({ where: { userId: current.userId } });
      await tx.pushDevice.updateMany({
        where: { userId: current.userId },
        data: { enabled: false },
      });
      return current;
    },
    { timeout: 15_000 },
  );
  return { role, userId: account.userId, accessKey };
}
