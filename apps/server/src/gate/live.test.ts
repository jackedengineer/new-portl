import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once as nodeOnce } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { Socket as ServerSocket } from 'socket.io';
import { afterEach, expect, it, vi } from 'vitest';
import { gateSignalSchema, type GateSubscription } from '@portl/contracts';
import { createGateSocketServer } from './live.js';

function once(socket: Socket, name: string) {
  return new Promise<unknown[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error(`Missing socket event: ${name}`));
    }, 3000);
    const receive = (...values: unknown[]) => {
      clearTimeout(timeout);
      resolve(values);
    };
    socket.once(name, receive);
  });
}
const cleanup: (() => Promise<void>)[] = [];
async function fixture() {
  const http = createServer();
  const authorize = vi.fn(
    async (
      _headers: IncomingHttpHeaders,
      sub: GateSubscription,
      requestId?: string,
    ) => {
      if (sub.userId !== 'resident' || sub.societyId !== 'society')
        throw new Error('denied');
      return requestId !== 'other-flat';
    },
  );
  const budget = vi.fn(async () => true);
  const live = createGateSocketServer(http, {
    authorize,
    budget,
    acceptsOrigin: (origin) => origin === 'portl://',
  });
  http.listen(0, '127.0.0.1');
  await nodeOnce(http, 'listening');
  const sockets: Socket[] = [];
  cleanup.push(async () => {
    sockets.forEach((s) => s.disconnect());
    await live.close();
  });
  function connect(
    auth = { userId: 'resident', societyId: 'society', view: 'RESIDENT' },
    origin = 'portl://',
    transport: 'websocket' | 'polling' = 'websocket',
    nativeOrigin?: string,
  ) {
    const socket = io(
      `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
      {
        autoConnect: false,
        transports: [transport],
        reconnection: false,
        extraHeaders: {
          origin,
          ...(nativeOrigin ? { 'expo-origin': nativeOrigin } : {}),
        },
        auth,
      },
    );
    sockets.push(socket);
    return socket;
  }
  return { live, authorize, budget, connect };
}
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});
it('sends only strict change signals after current resource authorization', async () => {
  const f = await fixture(),
    socket = f.connect();
  const connected = once(socket, 'connect');
  socket.connect();
  await connected;
  const received = once(socket, 'gate:changed');
  f.live.publish({ societyId: 'society', requestId: 'request', version: 2 });
  expect((await received)[0]).toEqual({
    societyId: 'society',
    requestId: 'request',
    version: 2,
  });
  expect(f.authorize).toHaveBeenLastCalledWith(
    expect.anything(),
    { userId: 'resident', societyId: 'society', view: 'RESIDENT' },
    'request',
  );
  expect(
    gateSignalSchema.safeParse({
      societyId: 'society',
      requestId: 'request',
      version: 2,
      visitorName: 'private',
    }).success,
  ).toBe(false);
});
it('rejects malformed scopes, forbidden identities and untrusted origins', async () => {
  const f = await fixture();
  for (const socket of [
    f.connect({ userId: 'outsider', societyId: 'society', view: 'RESIDENT' }),
    f.connect({ userId: 'resident', societyId: 'other', view: 'RESIDENT' }),
    f.connect(undefined, 'https://evil.invalid'),
    f.connect({ userId: 'resident', societyId: 'society', view: 'INVALID' }),
  ]) {
    const rejected = once(socket, 'connect_error');
    socket.connect();
    await rejected;
    expect(socket.connected).toBe(false);
  }
});
it('suppresses invisible requests and disconnects revoked users before delivery', async () => {
  const f = await fixture(),
    socket = f.connect();
  const changed = vi.fn();
  socket.on('gate:changed', changed);
  const connected = once(socket, 'connect');
  socket.connect();
  await connected;
  f.live.publish({ societyId: 'society', requestId: 'other-flat', version: 1 });
  await vi.waitFor(() => expect(f.authorize).toHaveBeenCalledTimes(2));
  expect(changed).not.toHaveBeenCalled();
  f.authorize.mockRejectedValue(new Error('revoked'));
  const disconnected = once(socket, 'disconnect');
  f.live.publish({ societyId: 'society', requestId: 'request', version: 2 });
  await disconnected;
  expect(changed).not.toHaveBeenCalled();
});
it('caps concurrent account connections and respects the connection budget', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) {
    const s = f.connect(),
      connected = once(s, 'connect');
    s.connect();
    await connected;
  }
  const extra = f.connect(),
    denied = once(extra, 'connect_error');
  extra.connect();
  await denied;
  expect(extra.connected).toBe(false);
  f.budget.mockResolvedValue(false);
  const limited = f.connect(),
    throttled = once(limited, 'connect_error');
  limited.connect();
  await throttled;
  expect(limited.connected).toBe(false);
});

it('supports HTTP polling and rejects a spoofed native origin beside an untrusted browser origin', async () => {
  const registered = vi.spyOn(ServerSocket.prototype, 'onAny');
  const f = await fixture();
  const socket = f.connect(undefined, 'portl://', 'polling');
  const ready = once(socket, 'connect');
  socket.connect();
  await ready;
  // The next poll must be waiting before a best-effort signal is deliverable.
  const serverSocket = registered.mock.contexts[0] as ServerSocket;
  await vi.waitFor(() =>
    expect(serverSocket.conn.transport.writable).toBe(true),
  );
  const received = once(socket, 'gate:changed');
  f.live.publish({ societyId: 'society', requestId: 'request', version: 1 });
  expect((await received)[0]).toEqual({
    societyId: 'society',
    requestId: 'request',
    version: 1,
  });
  const spoof = f.connect(
    undefined,
    'https://evil.invalid',
    'websocket',
    'portl://',
  );
  const denied = once(spoof, 'connect_error');
  spoof.connect();
  await denied;
  expect(spoof.connected).toBe(false);
});
it('bounds pending work and conflates repeated changes while authorization is slow', async () => {
  const emitted = vi.spyOn(ServerSocket.prototype, 'emit');
  const f = await fixture(),
    socket = f.connect();
  const ready = once(socket, 'connect');
  socket.connect();
  await ready;
  let release!: (value: boolean) => void;
  f.authorize.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const received: unknown[] = [];
  socket.on('gate:changed', (value) => received.push(value));
  f.live.publish({ societyId: 'society', requestId: 'inflight', version: 1 });
  for (let i = 0; i < 40; i++)
    f.live.publish({
      societyId: 'society',
      requestId: `request-${i}`,
      version: 1,
    });
  f.live.publish({ societyId: 'society', requestId: 'request-39', version: 3 });
  f.live.publish({ societyId: 'society', requestId: 'request-39', version: 2 });
  release(true);
  await vi.waitFor(() => expect(f.authorize).toHaveBeenCalledTimes(34));
  const attempted = emitted.mock.calls
    .filter(([event]) => event === 'gate:changed')
    .map(([, signal]) => signal);
  expect(attempted).toHaveLength(33);
  expect(attempted.at(-1)).toEqual({
    societyId: 'society',
    requestId: 'request-39',
    version: 3,
  });
  expect(attempted).not.toContainEqual({
    societyId: 'society',
    requestId: 'request-0',
    version: 1,
  });
  await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
  expect(
    received.every((signal) => gateSignalSchema.safeParse(signal).success),
  ).toBe(true);
});

it('drops signals while the transport is stalled and delivers fresh signals after recovery', async () => {
  const registered = vi.spyOn(ServerSocket.prototype, 'onAny');
  const f = await fixture(),
    socket = f.connect();
  const ready = once(socket, 'connect');
  socket.connect();
  await ready;
  const serverSocket = registered.mock.contexts[0] as ServerSocket;
  const connection = serverSocket.conn;
  await vi.waitFor(() => expect(connection.transport.writable).toBe(true));
  const received = vi.fn();
  socket.on('gate:changed', received);
  connection.transport.writable = false;
  try {
    for (let i = 0; i < 64; i++) {
      f.live.publish({
        societyId: 'society',
        requestId: `stalled-${i}`,
        version: 1,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(f.authorize).toHaveBeenCalledTimes(65);
    // Inspect Engine.IO's internal buffer to detect signals escaping the app queue cap.
    expect(connection['writeBuffer']).toHaveLength(0);
    expect(received).not.toHaveBeenCalled();
  } finally {
    connection.transport.writable = true;
  }
  const fresh = once(socket, 'gate:changed');
  f.live.publish({
    societyId: 'society',
    requestId: 'after-recovery',
    version: 2,
  });
  expect((await fresh)[0]).toEqual({
    societyId: 'society',
    requestId: 'after-recovery',
    version: 2,
  });
  expect(received).toHaveBeenCalledTimes(1);
});

it('bounds outstanding authorization across disconnected handshakes and releases capacity when checks finish', async () => {
  const f = await fixture();
  const release: (() => void)[] = [];
  let started: (() => void) | undefined;
  f.authorize.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        release.push(() => resolve(true));
        started?.();
      }),
  );
  try {
    for (let i = 0; i < 100; i++) {
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const socket = f.connect();
      socket.connect();
      await entered;
      socket.disconnect();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const excess = f.connect(),
      denied = once(excess, 'connect_error');
    excess.connect();
    await denied;
    expect(f.authorize).toHaveBeenCalledTimes(100);
    expect(f.budget).not.toHaveBeenCalled();
    for (const finish of release.splice(0)) finish();
    await vi.waitFor(() => expect(f.budget).toHaveBeenCalledTimes(100));
    f.authorize.mockResolvedValue(true);
    const recovered = f.connect(),
      connected = once(recovered, 'connect');
    recovered.connect();
    await connected;
    expect(recovered.connected).toBe(true);
  } finally {
    for (const finish of release) finish();
  }
}, 10_000);
it('does not accept gate commands over a socket', async () => {
  const f = await fixture(),
    socket = f.connect();
  const ready = once(socket, 'connect');
  socket.connect();
  await ready;
  const disconnected = once(socket, 'disconnect');
  socket.emit('approve', { requestId: 'request' });
  await disconnected;
  expect(f.authorize).toHaveBeenCalledTimes(1);
});
