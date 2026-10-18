import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { supervise, childEnvironment } from './supervisor.js';
class Child extends EventEmitter {
  send = vi.fn(() => true);
  kill = vi.fn(() => true);
}
afterEach(() => vi.useRealTimers());
it('passes only each process’s required credentials', () => {
  const env = {
    TRUST_PROXY_HOPS: '1',
    DATABASE_URL: 'api',
    WORKER_DATABASE_URL: 'worker',
    ERASURE_LEDGER_DATABASE_URL: 'ledger',
    BETTER_AUTH_SECRET: 'shared',
    DIRECT_DATABASE_URL: 'owner',
    ERASURE_LEDGER_OWNER_URL: 'ledger-owner',
    RESEND_API_KEY: 'resend',
    EXPO_ACCESS_TOKEN: 'expo',
  };
  expect(childEnvironment('api', env)).toEqual({
    TRUST_PROXY_HOPS: '1',
    DATABASE_URL: 'api',
    BETTER_AUTH_SECRET: 'shared',
    RESEND_API_KEY: 'resend',
    PORTL_MANAGED_WORKER: '1',
  });
  expect(childEnvironment('worker', env)).toEqual({
    WORKER_DATABASE_URL: 'worker',
    ERASURE_LEDGER_DATABASE_URL: 'ledger',
    BETTER_AUTH_SECRET: 'shared',
    EXPO_ACCESS_TOKEN: 'expo',
    PORTL_WORKER_IDLE_MS: '90000',
  });
});
it('starts API after worker readiness, parks cleanly, and restarts on a wake during shutdown', () => {
  vi.useFakeTimers();
  const spawned: { kind: string; child: Child }[] = [],
    fail = vi.fn();
  const managed = supervise((kind) => {
    const child = new Child();
    spawned.push({ kind, child });
    return child;
  }, fail);
  expect(spawned.map((row) => row.kind)).toEqual(['worker']);
  spawned[0]!.child.emit('message', { type: 'ready' });
  expect(spawned.map((row) => row.kind)).toEqual(['worker', 'api']);
  spawned[1]!.child.emit('message', { type: 'ready' });
  spawned[0]!.child.emit('message', { type: 'parking' });
  spawned[1]!.child.emit('message', { type: 'work' });
  spawned[0]!.child.emit('message', { type: 'parked' });
  spawned[0]!.child.emit('exit', 0, null);
  expect(spawned.map((row) => row.kind)).toEqual(['worker', 'api', 'worker']);
  expect(fail).not.toHaveBeenCalled();
  managed.stop();
});
it('wakes an idle worker periodically and fails the service when a child crashes', async () => {
  vi.useFakeTimers();
  const children: Child[] = [],
    fail = vi.fn();
  const managed = supervise(() => {
    const child = new Child();
    children.push(child);
    return child;
  }, fail);
  children[0]!.emit('message', { type: 'ready' });
  children[1]!.emit('message', { type: 'ready' });
  children[0]!.emit('message', { type: 'parking' });
  children[0]!.emit('message', { type: 'parked' });
  children[0]!.emit('exit', 0, null);
  await vi.advanceTimersByTimeAsync(30 * 60000);
  expect(children).toHaveLength(3);
  children[2]!.emit('exit', 1, null);
  expect(fail).toHaveBeenCalledWith(1);
  expect(children[1]!.kill).toHaveBeenCalledWith('SIGTERM');
  managed.stop();
});
it('does not silently serve when worker startup never reaches readiness', async () => {
  vi.useFakeTimers();
  const child = new Child(),
    fail = vi.fn();
  const managed = supervise(() => child, fail);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fail).toHaveBeenCalledWith(1);
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  managed.stop();
});
