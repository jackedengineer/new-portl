import type { ResidentRelationship } from '../generated/prisma/client.js';
import { DomainError, type Tx } from './context.js';

export async function grantResident(
  tx: Tx,
  societyId: string,
  userId: string,
  flatId: string,
  relationship: ResidentRelationship,
) {
  // Serialize invitation/application overlap for one person in one society.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${societyId + ':' + userId}, 0))`;
  const flat = await tx.flat.findFirst({
    where: { id: flatId, societyId, archived: false },
  });
  if (!flat)
    throw new DomainError(
      409,
      'FLAT_UNAVAILABLE',
      'This flat is no longer available',
    );
  const existing = await tx.occupancy.findUnique({
    where: { societyId_flatId_userId: { societyId, flatId, userId } },
  });
  if (existing && !existing.endedAt && existing.relationship !== relationship)
    throw new DomainError(
      409,
      'RELATIONSHIP_CONFLICT',
      'Contact the society office to update your flat relationship',
    );
  await tx.membership.upsert({
    where: { societyId_userId_role: { societyId, userId, role: 'RESIDENT' } },
    create: { societyId, userId, role: 'RESIDENT' },
    update: { active: true },
  });
  if (!existing)
    await tx.occupancy.create({
      data: { societyId, flatId, userId, relationship },
    });
  else if (existing.endedAt)
    await tx.occupancy.update({
      where: { id: existing.id },
      data: { relationship, startedAt: new Date(), endedAt: null },
    });
}
