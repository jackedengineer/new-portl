import { afterEach, expect, it, vi } from 'vitest';
import { idleWorker } from './idle-worker.js';
afterEach(() => vi.useRealTimers());
it('parks only after inactivity and drains active work before closing', async () => {
  vi.useFakeTimers();
  const close = vi.fn().mockResolvedValue(undefined),
    error = vi.fn();
  const idle = idleWorker(90000, close, error);
  let finish!: () => void;
  const work = idle.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(100000);
  expect(close).not.toHaveBeenCalled();
  finish();
  await work;
  await vi.advanceTimersByTimeAsync(89000);
  expect(close).not.toHaveBeenCalled();
  idle.touch();
  await vi.advanceTimersByTimeAsync(90000);
  expect(close).toHaveBeenCalledTimes(1);
  expect(idle.touch()).toBe(false);
  idle.stop();
  expect(error).not.toHaveBeenCalled();
});
it('does not treat empty polls as activity and reports failed parking', async () => {
  vi.useFakeTimers();
  const error = vi.fn(),
    close = vi.fn().mockRejectedValue(new Error('unavailable'));
  const idle = idleWorker(90000, close, error);
  await vi.advanceTimersByTimeAsync(90000);
  expect(close).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
  idle.stop();
});
