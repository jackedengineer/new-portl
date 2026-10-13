import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useGateSocket } from '../features/gate/socket';
const mockCookie = jest.fn();
const mockIo = jest.fn();
jest.mock('../lib/auth-client', () => ({
  apiURL: 'http://localhost:3000',
  authClient: { getCookie: () => mockCookie() },
}));
jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));
jest.mock('../features/gate/live', () => ({
  gateKey: (uid: string, sid: string) => ['gate', uid, sid],
}));
function transport() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    on: jest.fn((name: string, handler: (...args: unknown[]) => void) => {
      handlers.set(name, handler);
    }),
    connect: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(() => handlers.clear()),
    receive: (name: string, value?: unknown) => handlers.get(name)?.(value),
  };
  return socket;
}
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const reset = jest.spyOn(client, 'resetQueries');
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    invalidate,
    reset,
    ...renderHook(
      ({ uid, sid, enabled }: { uid: string; sid: string; enabled: boolean }) =>
        useGateSocket(uid, sid, 'RESIDENT', enabled),
      { initialProps: { uid: 'u1', sid: 's1', enabled: true }, wrapper },
    ),
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  mockCookie.mockResolvedValue('private-cookie');
  mockIo.mockImplementation(() => transport());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
it('uses scoped cookie authentication and refreshes authoritative queries on connect and valid bursts', async () => {
  const h = show();
  await settle();
  const socket = mockIo.mock.results[0].value;
  expect(mockIo).toHaveBeenCalledWith(
    'http://localhost:3000',
    expect.objectContaining({
      auth: { userId: 'u1', societyId: 's1', view: 'RESIDENT' },
      extraHeaders: { cookie: 'private-cookie', 'expo-origin': 'portl://' },
      reconnection: false,
    }),
  );
  act(() => socket.receive('connect'));
  expect(h.result.current).toBe(true);
  act(() => jest.advanceTimersByTime(100));
  expect(h.invalidate).toHaveBeenCalledTimes(1);
  act(() => {
    socket.receive('gate:changed', {
      societyId: 'other',
      requestId: 'r1',
      version: 1,
    });
    socket.receive('gate:changed', {
      societyId: 's1',
      requestId: 'r1',
      version: 1,
      private: 'extra',
    });
    jest.advanceTimersByTime(100);
  });
  expect(h.invalidate).toHaveBeenCalledTimes(1);
  act(() => {
    for (let i = 1; i < 20; i++)
      socket.receive('gate:changed', {
        societyId: 's1',
        requestId: 'r1',
        version: i,
      });
    jest.advanceTimersByTime(100);
  });
  expect(h.invalidate).toHaveBeenCalledTimes(2);
  expect(h.invalidate).toHaveBeenLastCalledWith({
    queryKey: ['gate', 'u1', 's1'],
  });
  h.unmount();
});
it('re-reads cookies on reconnect, clears rejected data, and cancels retries in the background', async () => {
  const h = show();
  await settle();
  const socket = mockIo.mock.results[0].value;
  act(() => {
    socket.receive('connect');
    socket.receive('disconnect', 'io server disconnect');
  });
  expect(h.result.current).toBe(false);
  expect(h.reset).toHaveBeenCalledWith({ queryKey: ['gate', 'u1', 's1'] });
  mockCookie.mockResolvedValue('renewed-cookie');
  act(() => jest.advanceTimersByTime(1600));
  await settle();
  expect(mockCookie).toHaveBeenCalledTimes(2);
  expect(mockIo.mock.calls[1][1].extraHeaders.cookie).toBe('renewed-cookie');
  h.rerender({ uid: 'u1', sid: 's1', enabled: false });
  expect(mockIo.mock.results[1].value.disconnect).toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(60000));
  expect(mockIo).toHaveBeenCalledTimes(2);
  h.unmount();
});
it('does not start a connection after an obsolete asynchronous cookie read', async () => {
  let finish!: (cookie: string) => void;
  mockCookie.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const h = show();
  h.rerender({ uid: 'u2', sid: 's2', enabled: true });
  await settle();
  await act(async () => finish('obsolete-cookie'));
  expect(mockIo).toHaveBeenCalledTimes(1);
  expect(mockIo.mock.calls[0][1].auth).toEqual({
    userId: 'u2',
    societyId: 's2',
    view: 'RESIDENT',
  });
  h.unmount();
});
it('disconnects and ignores callbacks captured before a scope change', async () => {
  const h = show();
  await settle();
  const old = mockIo.mock.results[0].value;
  const captured = old.on.mock.calls.find(
    (c: unknown[]) => c[0] === 'gate:changed',
  )[1];
  act(() => old.receive('connect'));
  h.rerender({ uid: 'u1', sid: 's2', enabled: true });
  expect(h.result.current).toBe(false);
  act(() => {
    captured({ societyId: 's1', requestId: 'r1', version: 1 });
    jest.advanceTimersByTime(100);
  });
  expect(h.invalidate).not.toHaveBeenCalled();
  expect(old.disconnect).toHaveBeenCalled();
  await settle();
  h.unmount();
});
