import type { PrismaClient } from '../generated/prisma/client.js';
import {
  DomainError,
  requireAdmin,
  withActor,
  type Actor,
  type Tx,
} from '../registry/context.js';
export const unavailable = () =>
  new DomainError(404, 'NOT_FOUND', 'This record is unavailable');
export const conflict = (
  message = 'This record changed. Refresh before trying again.',
) => new DomainError(409, 'CONFLICT', message);
export const page = <T extends { id: string }>(rows: T[]) => ({
  items: rows.slice(0, 20),
  nextCursor: rows.length > 20 ? rows[19]!.id : null,
});
export async function adminWork<T>(
  db: PrismaClient,
  actor: Actor,
  sid: string,
  work: (tx: Tx) => Promise<T>,
) {
  try {
    return await withActor(db, actor, async (tx) => {
      await requireAdmin(tx, actor, sid);
      return work(tx);
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      ['P2002', 'P2003', 'P2034'].includes(String(error.code))
    )
      throw conflict(
        'This change conflicts with an existing record. Refresh and try again.',
      );
    if (
      typeof error === 'object' &&
      error &&
      'meta' in error &&
      typeof error.meta === 'object' &&
      error.meta &&
      'code' in error.meta &&
      ['23514', '23505', '40001', '40P01'].includes(String(error.meta.code))
    )
      throw conflict(
        'This record is in use or changed. Refresh and try again.',
      );
    throw error;
  }
}
