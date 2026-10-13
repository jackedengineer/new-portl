import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { PassList } from '../features/gate/pass-list';
import { PassCreate } from '../features/gate/pass-create';
import { PassDetail } from '../features/gate/pass-detail';
import { PassVerify } from '../features/gate/pass-verify';
import { istWindow } from '../features/gate/pass-time';
import { ApiError } from '../lib/api';
const mockApi = jest.fn();
let mockOnline = true;
jest.mock('../features/gate/live', () => ({
  ...jest.requireActual('../features/gate/live'),
  useLiveGate: () => ({
    enabled: mockOnline,
    online: mockOnline,
    clock: Date.now(),
  }),
}));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  messageOf: (e: Error) => e.message,
  ApiError: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useFocusEffect: (fn: () => void) => {
    jest.requireActual('react').useEffect(fn, [fn]);
  },
  router: { canGoBack: () => false, push: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'd1b04f37-80ea-41ab-974b-dc7e11de212d',
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const code = 'ABCDEFGHJKMNPQRS';
const pass = {
  id: 'p1',
  version: 1,
  visitorName: 'Invited Guest',
  flat: { id: 'f1', tower: 'A', label: '101' },
  status: 'READY',
  presence: 'NOT_ENTERED',
  createdAt: new Date().toISOString(),
  validFrom: new Date(Date.now() - 60000).toISOString(),
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  events: [],
};
function show(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>{component}</QueryClientProvider>,
    ),
    client,
  };
}
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  mockOnline = true;
  mockApi.mockReset();
  AppState.currentState = 'active';
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/code')
        ? { code }
        : path.includes('/setup')
          ? {
              gates: [{ id: 'g1', name: 'Main gate' }],
              flats: [pass.flat],
              assignments: [],
              serverNow: new Date().toISOString(),
            }
          : path.endsWith('/verify') || path.includes('/passes/p1?')
            ? { pass, serverNow: new Date().toISOString() }
            : { passId: 'p1', version: 2 },
    ),
  );
});
it('parses IST independently of device timezone and rejects impossible calendar dates', () => {
  expect(istWindow('2026-10-12', '10:30', 60)).toEqual({
    validFrom: '2026-10-12T05:00:00.000Z',
    validUntil: '2026-10-12T06:00:00.000Z',
  });
  for (const [date, time] of [
    ['2026-02-30', '10:00'],
    ['2026-13-01', '10:00'],
    ['2026-10-12', '24:00'],
    ['12/10/2026', '10:00'],
  ])
    expect(istWindow(date!, time!, 60)).toBeNull();
});
it('validates guest details and retains an identical creation intent after an uncertain response', async () => {
  mockApi.mockImplementation((path: string) =>
    path.endsWith('/passes')
      ? Promise.reject(new Error('Connection lost'))
      : Promise.resolve({
          flats: [pass.flat],
          serverNow: new Date().toISOString(),
        }),
  );
  show(<PassCreate userId="u1" societyId="s1" />);
  await screen.findByText('Your flat');
  fireEvent.press(screen.getByRole('button', { name: 'Create guest pass' }));
  expect(
    await screen.findByText(
      'Enter the guest name, a valid date and time, and your flat.',
    ),
  ).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Guest name'), 'Invited Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Create guest pass' }));
  await screen.findByText('Connection lost');
  const first = mockApi.mock.calls.find((c) => c[0].endsWith('/passes'))[2];
  fireEvent.press(screen.getByRole('button', { name: 'Retry creating pass' }));
  await waitFor(() =>
    expect(
      mockApi.mock.calls.filter((c) => c[0].endsWith('/passes')).length,
    ).toBe(2),
  );
  expect(
    mockApi.mock.calls.filter((c) => c[0].endsWith('/passes'))[1][2],
  ).toEqual(first);
});
it('reveals credentials only on request, never stores them in query or mutation cache, and hides them on background', async () => {
  let background: (value: AppStateStatus) => void = () => {};
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, fn) => {
      background = fn;
      return { remove: jest.fn() };
    });
  const { client } = show(
    <PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />,
  );
  await screen.findByText('Invited Guest');
  expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Show pass code' }));
  await screen.findByText('ABCD-EFGH-JKMN-PQRS');
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain(code);
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ),
  ).not.toContain(code);
  act(() => background('background'));
  expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
  listener.mockRestore();
});
it('does not restore an in-flight reveal after the app backgrounds', async () => {
  let background: (value: AppStateStatus) => void = () => {},
    resolve!: (value: { code: string }) => void;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, fn) => {
      background = fn;
      return { remove: jest.fn() };
    });
  mockApi.mockImplementation((path: string) =>
    path.endsWith('/code')
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({ pass, serverNow: new Date().toISOString() }),
  );
  show(<PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />);
  await screen.findByText('Invited Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Show pass code' }));
  await act(async () => {
    background('background');
    resolve({ code });
  });
  expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
  listener.mockRestore();
});
it('requires a presented code and physical confirmation, retries the same entry, and keeps it out of caches', async () => {
  mockApi.mockImplementation((path: string) =>
    path.endsWith('/entry')
      ? Promise.reject(new Error('Connection lost'))
      : Promise.resolve(
          path.includes('setup')
            ? {
                gates: [{ id: 'g1', name: 'Main gate' }],
                flats: [],
                assignments: [],
                serverNow: new Date().toISOString(),
              }
            : { pass, serverNow: new Date().toISOString() },
        ),
  );
  const { client } = show(<PassVerify userId="u1" societyId="s1" />);
  await screen.findByRole('radio', { name: 'Main gate' });
  fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
  await screen.findByText(
    'Enter the 16-character code shown on the guest pass.',
  );
  fireEvent.changeText(
    screen.getByLabelText('Guest pass code'),
    'abcd-efgh-jkmn-pqrs',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
  await screen.findByText('Invited Guest');
  expect(mockApi.mock.calls.some((c) => c[0].endsWith('/entry'))).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'Record guest entry' }));
  fireEvent.press(screen.getByRole('button', { name: 'Confirm guest entry' }));
  await screen.findByText('Connection lost');
  const first = mockApi.mock.calls.find((c) => c[0].endsWith('/entry'))[2];
  expect(first).toMatchObject({ code, expectedVersion: 1, gateId: 'g1' });
  fireEvent.press(screen.getByRole('button', { name: 'Retry same entry' }));
  await waitFor(() =>
    expect(
      mockApi.mock.calls.filter((c) => c[0].endsWith('/entry')).length,
    ).toBe(2),
  );
  expect(
    mockApi.mock.calls.filter((c) => c[0].endsWith('/entry'))[1][2],
  ).toEqual(first);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state),
    ),
  ).not.toContain(code);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('requires confirmation to revoke and gives admins no credential or movement controls', async () => {
  const shown = show(
    <PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />,
  );
  await screen.findByText('Invited Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Revoke guest pass' }));
  expect(mockApi.mock.calls.some((c) => c[0].endsWith('/revoke'))).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'Confirm action' }));
  await waitFor(() =>
    expect(
      mockApi.mock.calls.some(
        (c) => c[0].endsWith('/revoke') && c[2].expectedVersion === 1,
      ),
    ).toBe(true),
  );
  expect(mockApi.mock.calls.every((call) => call[4] === 'u1')).toBe(true);
  shown.unmount();
  show(<PassDetail userId="u1" societyId="s1" id="p1" view="ADMIN" />);
  await screen.findByText('Invited Guest');
  expect(screen.queryByRole('button', { name: 'Show pass code' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Revoke guest pass' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mark guest exit' })).toBeNull();
});
it('disables cached resident actions when offline', async () => {
  const shown = show(
    <PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />,
  );
  await screen.findByText('Invited Guest');
  mockOnline = false;
  shown.rerender(
    <QueryClientProvider client={shown.client}>
      <PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Show pass code' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Revoke guest pass' }),
  ).toBeDisabled();
});

it.each([401, 403, 404])(
  'hides cached pass details and history and wipes a revealed code after access fails with %s',
  async (status) => {
    const detail = {
      pass: {
        ...pass,
        events: [
          {
            id: 'event1',
            type: 'ENTRY',
            gate: { id: 'g1', name: 'Private entrance' },
            at: new Date().toISOString(),
          },
        ],
      },
      serverNow: new Date().toISOString(),
    };
    mockApi.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/code') ? { code } : detail),
    );
    show(<PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />);
    await screen.findByText('Private entrance');
    fireEvent.press(screen.getByRole('button', { name: 'Show pass code' }));
    await screen.findByText('ABCD-EFGH-JKMN-PQRS');

    // A different society role keeps this screen mounted after residency ends.
    mockApi.mockRejectedValue(
      new ApiError(status, 'ACCESS_UNAVAILABLE', 'Access no longer available'),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findByText('Access no longer available');
    expect(screen.queryByText('Invited Guest')).toBeNull();
    expect(screen.queryByText('Private entrance')).toBeNull();
    expect(screen.queryByText('Movement history')).toBeNull();
    expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Revoke guest pass' }),
    ).toBeNull();

    mockApi.mockResolvedValue(detail);
    fireEvent.press(screen.getByRole('button', { name: 'Retry pass' }));
    await screen.findByText('Invited Guest');
    expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show pass code' })).toBeTruthy();
    expect(mockApi.mock.calls.every((call) => call[4] === 'u1')).toBe(true);
  },
);

it.each([401, 403, 404])(
  'hides cached guest-pass list cards after access fails with %s',
  async (status) => {
    mockApi.mockResolvedValue({
      items: [pass],
      nextCursor: 'p2',
      serverNow: new Date().toISOString(),
    });
    show(<PassList userId="u1" societyId="s1" view="RESIDENT" />);
    await screen.findByText('Invited Guest');
    mockApi.mockRejectedValue(
      new ApiError(status, 'ACCESS_UNAVAILABLE', 'Access no longer available'),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Refresh passes' }));
    await screen.findByText('Access no longer available');
    expect(screen.queryByText('Invited Guest')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'View Invited Guest' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Create guest pass' }),
    ).toBeDisabled();
    expect(mockApi.mock.calls.every((call) => call[4] === 'u1')).toBe(true);
  },
);

it('keeps cached details read-only after a transport failure', async () => {
  show(<PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />);
  await screen.findByText('Invited Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Show pass code' }));
  await screen.findByText('ABCD-EFGH-JKMN-PQRS');
  mockApi.mockRejectedValue(
    new ApiError(0, 'CONNECTION_ERROR', 'Connection lost'),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Connection lost');
  expect(screen.getByText('Invited Guest')).toBeTruthy();
  expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share guest pass' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Show pass code' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Revoke guest pass' }),
  ).toBeDisabled();
});

it('discards a pending reveal after authoritative access loss even if a later refresh succeeds', async () => {
  let resolveCode!: (value: { code: string }) => void;
  const detail = { pass, serverNow: new Date().toISOString() };
  mockApi.mockImplementation((path: string) =>
    path.endsWith('/code')
      ? new Promise((resolve) => {
          resolveCode = resolve;
        })
      : Promise.resolve(detail),
  );
  show(<PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />);
  await screen.findByText('Invited Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Show pass code' }));
  mockApi.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Access revoked'));
  fireEvent.press(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Access revoked');
  mockApi.mockResolvedValue(detail);
  fireEvent.press(screen.getByRole('button', { name: 'Retry pass' }));
  await screen.findByText('Invited Guest');
  await act(async () => resolveCode({ code }));
  expect(screen.queryByText('ABCD-EFGH-JKMN-PQRS')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show pass code' })).toBeTruthy();
});

it('binds guard setup and exit commands to the screen identity', async () => {
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/setup')
        ? {
            gates: [{ id: 'g1', name: 'Main gate' }],
            flats: [],
            assignments: [],
            serverNow: new Date().toISOString(),
          }
        : path.endsWith('/exit')
          ? { passId: 'p1', version: 2 }
          : {
              pass: { ...pass, status: 'INSIDE', presence: 'INSIDE' },
              serverNow: new Date().toISOString(),
            },
    ),
  );
  show(<PassDetail userId="guard1" societyId="s1" id="p1" view="GUARD" />);
  await screen.findByRole('radio', { name: 'Main gate' });
  fireEvent.press(screen.getByRole('button', { name: 'Mark guest exit' }));
  fireEvent.press(screen.getByRole('button', { name: 'Confirm action' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.some((call) => call[0].endsWith('/exit'))).toBe(
      true,
    ),
  );
  expect(mockApi.mock.calls.every((call) => call[4] === 'guard1')).toBe(true);
});

it('keeps cached list cards read-only after a transport failure', async () => {
  mockApi.mockResolvedValue({
    items: [pass],
    nextCursor: null,
    serverNow: new Date().toISOString(),
  });
  show(<PassList userId="u1" societyId="s1" view="RESIDENT" />);
  await screen.findByText('Invited Guest');
  mockApi.mockRejectedValue(
    new ApiError(0, 'CONNECTION_ERROR', 'Connection lost'),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Refresh passes' }));
  await screen.findByText('Connection lost');
  expect(screen.getByText('Invited Guest')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Create guest pass' }),
  ).toBeDisabled();
});

it('renders pass list and detail without text outside native Text hosts', async () => {
  mockApi.mockResolvedValue({
    items: [pass],
    nextCursor: null,
    serverNow: new Date().toISOString(),
  });
  const list = show(<PassList userId="u1" societyId="s1" view="RESIDENT" />);
  await screen.findByText('Invited Guest');
  function check(node: ReturnType<typeof list.toJSON>) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(check);
      return;
    }
    for (const child of node.children ?? []) {
      if (typeof child === 'string') expect(node.type).toBe('Text');
      else check(child);
    }
  }
  check(list.toJSON());
  list.unmount();
  mockApi.mockResolvedValue({ pass, serverNow: new Date().toISOString() });
  const detail = show(
    <PassDetail userId="u1" societyId="s1" id="p1" view="RESIDENT" />,
  );
  await screen.findByText('Invited Guest');
  check(detail.toJSON());
});
