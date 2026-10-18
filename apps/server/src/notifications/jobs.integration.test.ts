import { expect, it, vi } from 'vitest';
import { createDatabase, databasePool } from '../database/client.js';
import { notificationQueue } from './jobs.js';

it('keeps an idle API producer free of periodic SQL during an eight-minute health-check window', async () => {
  if (!process.env.PORTL_TEST_DATABASE_URL)
    throw new Error('Isolated integration database required');
  const db = createDatabase(process.env.PORTL_TEST_DATABASE_URL),
    boss = notificationQueue(db);
  const query = vi.spyOn(databasePool(db), 'query');
  // Only intervals are simulated: real network I/O and connection deadlines run normally.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    await boss.start();
    const started = query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(8 * 60000);
    expect(query).toHaveBeenCalledTimes(started);
  } finally {
    await boss.stop();
    vi.useRealTimers();
    query.mockRestore();
    await db.$disconnect();
  }
});
