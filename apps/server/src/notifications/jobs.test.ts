import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { withNotificationTransaction } from './jobs.js';
const { commit, hint } = vi.hoisted(() => ({ commit: vi.fn(), hint: vi.fn() }));
vi.mock('../registry/context.js', () => ({ withActor: commit }));
vi.mock('../hosting/activity.js', () => ({ signalWorker: hint }));
vi.mock('../database/client.js', () => ({ databasePool: () => ({}) }));
vi.mock('pg-boss', () => ({
  fromPrisma: () => ({}),
  PgBoss: class {
    on() {}
    async start() {}
  },
}));
const actor = {
  userId: 'user',
  email: 'user@test.invalid',
  sessionId: 'session',
  requestId: 'request',
};
it('wakes the worker only after the domain transaction commits', async () => {
  let resolve!: (value: string) => void;
  commit.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  hint.mockClear();
  const result = withNotificationTransaction(
    {} as PrismaClient,
    actor,
    async () => 'committed',
  );
  await vi.waitFor(() => expect(commit).toHaveBeenCalled());
  expect(hint).not.toHaveBeenCalled();
  resolve('committed');
  await expect(result).resolves.toBe('committed');
  expect(hint).toHaveBeenCalledOnce();
});
it('does not wake the worker for a rolled-back transaction', async () => {
  commit.mockRejectedValueOnce(new Error('rollback'));
  hint.mockClear();
  await expect(
    withNotificationTransaction(
      {} as PrismaClient,
      actor,
      async () => 'unused',
    ),
  ).rejects.toThrow('rollback');
  expect(hint).not.toHaveBeenCalled();
});
