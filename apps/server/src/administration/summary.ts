import type { PrismaClient } from '../generated/prisma/client.js';
import type { Actor } from '../registry/context.js';
import { adminWork } from './context.js';
export const administrationSummary = (
  db: PrismaClient,
  actor: Actor,
  sid: string,
) =>
  adminWork(db, actor, sid, async (tx) => {
    const [
      towers,
      flats,
      residents,
      pendingApplications,
      gates,
      guardRows,
      staff,
      serviceProviders,
    ] = await Promise.all([
      tx.tower.count({ where: { societyId: sid, archived: false } }),
      tx.flat.count({ where: { societyId: sid, archived: false } }),
      tx.membership.count({
        where: {
          societyId: sid,
          role: 'RESIDENT',
          active: true,
          user: {
            occupancies: {
              some: {
                societyId: sid,
                endedAt: null,
                flat: { archived: false },
              },
            },
          },
        },
      }),
      tx.residentApplication.count({
        where: { societyId: sid, status: 'PENDING' },
      }),
      tx.gate.count({ where: { societyId: sid, active: true } }),
      tx.$queryRaw<
        { count: number }[]
      >`SELECT count(DISTINCT a."userId")::integer AS count FROM portl_registry."GuardAssignment" a JOIN portl_registry."Gate" g ON g.id=a."gateId" AND g."societyId"=a."societyId" AND g.active JOIN portl_registry."Membership" m ON m."userId"=a."userId" AND m."societyId"=a."societyId" AND m.role='GUARD' AND m.active WHERE a."societyId"=${sid} AND a.active`,
      tx.directoryEntry.count({
        where: { societyId: sid, archived: false, kind: 'STAFF' },
      }),
      tx.directoryEntry.count({
        where: { societyId: sid, archived: false, kind: 'SERVICE_PROVIDER' },
      }),
    ]);
    return {
      towers,
      flats,
      residents,
      pendingApplications,
      gates,
      guards: guardRows[0]!.count,
      staff,
      serviceProviders,
    };
  });
