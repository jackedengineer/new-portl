import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, AppState } from 'react-native';
import { VisitorQueue } from '../features/gate/visitor-queue';
import { Registration } from '../features/gate/registration';
import { AdminGates } from '../features/gate/admin-gates';
import { VisitDetail } from '../features/gate/visit-detail';
import { PassCreate } from '../features/gate/pass-create';
import { PassVerify } from '../features/gate/pass-verify';
let mockSocketConnected = true;
jest.mock('../features/gate/socket', () => ({
  useGateSocket: () => mockSocketConnected,
}));
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
    status = 0;
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
const at = Date.now();
const visitor = {
  id: 'r1',
  version: 1,
  visitorName: 'A Guest',
  category: 'GUEST',
  company: null,
  flat: { id: 'f1', tower: 'A', label: '101' },
  gate: { id: 'g1', name: 'Main gate' },
  status: 'PENDING',
  presence: 'NOT_ENTERED',
  events: [],
  createdAt: new Date(at).toISOString(),
  expiresAt: new Date(at + 600000).toISOString(),
  approvedUntil: null,
  decidedAt: null,
};
function showQueue() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <VisitorQueue userId="u1" societyId="s1" view="RESIDENT" />
    </QueryClientProvider>,
  );
  return client;
}
it('shows just one loading indicator while the initial gate queue is loading', async () => {
  let resolve!: (value: unknown) => void;
  mockApi.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const client = showQueue();
  expect(screen.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => resolve({ items: [visitor], nextCursor: null }));
  await screen.findByText('A Guest');
  client.clear();
});
it('keeps existing queue content and refresh button quiet during a background update', async () => {
  mockApi.mockResolvedValue({ items: [visitor], nextCursor: null });
  const client = showQueue();
  await screen.findByText('A Guest');
  let resolve!: (value: unknown) => void;
  mockApi.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let refreshing!: Promise<void>;
  await act(async () => {
    refreshing = client.refetchQueries();
  });
  const busy = screen.getByRole('button', { name: 'Refresh visitors' }).props
    .accessibilityState.busy;
  const indicators = screen.UNSAFE_queryAllByType(ActivityIndicator).length;
  expect(screen.getByText('A Guest')).toBeTruthy();
  await act(async () => {
    resolve({ items: [visitor], nextCursor: null });
    await refreshing;
  });
  expect(busy).toBe(false);
  expect(indicators).toBe(0);
  client.clear();
});
it('shows refresh feedback only after a resident explicitly requests an update', async () => {
  mockApi.mockResolvedValue({ items: [visitor], nextCursor: null });
  const client = showQueue();
  await screen.findByText('A Guest');
  let resolve!: (value: unknown) => void;
  mockApi.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Refresh visitors' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh visitors' }).props
        .accessibilityState.busy,
    ).toBe(true),
  );
  expect(screen.getByText('A Guest')).toBeTruthy();
  await act(async () => resolve({ items: [], nextCursor: null }));
  await screen.findByText('No visitors waiting');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh visitors' }).props
        .accessibilityState.busy,
    ).toBe(false),
  );
  client.clear();
});
it('uses a thirty-second fallback instead of polling the gate queue every five seconds', async () => {
  jest.useFakeTimers();
  mockSocketConnected = false;
  mockApi.mockResolvedValue({ items: [visitor], nextCursor: null });
  const client = showQueue();
  try {
    await screen.findByText('A Guest');
    const initial = mockApi.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    const afterFiveSeconds = mockApi.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(25000);
    });
    expect(afterFiveSeconds).toBe(initial);
    expect(mockApi.mock.calls.length).toBe(initial + 1);
  } finally {
    client.clear();
    jest.useRealTimers();
  }
});
function show(view: 'RESIDENT' | 'GUARD' | 'ADMIN' = 'RESIDENT') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>
        <VisitDetail userId="u1" societyId="s1" id="r1" view={view} />
      </QueryClientProvider>,
    ),
    client,
  };
}
beforeEach(() => {
  mockOnline = true;
  mockSocketConnected = true;
  mockApi.mockImplementation((path: string, _schema: unknown, body: unknown) =>
    Promise.resolve(
      body
        ? { requestId: 'r1', version: 2 }
        : path.includes('setup')
          ? {
              gates: [visitor.gate],
              flats: [],
              assignments: [],
              serverNow: new Date().toISOString(),
            }
          : { request: visitor, serverNow: new Date().toISOString() },
    ),
  );
});
it('requires confirmation before a resident approves and sends the observed version', async () => {
  show();
  await screen.findByText('A Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Approve visitor' }));
  expect(mockApi.mock.calls.some((c) => c[2])).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'Confirm action' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/societies/s1/gate/requests/r1/decision',
      expect.anything(),
      { intentId: expect.any(String), expectedVersion: 1, decision: 'APPROVE' },
      undefined,
      'u1',
    ),
  );
});
it('never gives a guard resident approval controls or an entry button for a pending request', async () => {
  show('GUARD');
  await screen.findByText('A Guest');
  expect(screen.queryByRole('button', { name: 'Approve visitor' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mark entry' })).toBeNull();
  expect(
    screen.getByText(
      'Wait for a resident’s decision before admitting this visitor.',
    ),
  ).toBeTruthy();
});
it('shows completed movement to admins with no admission controls', async () => {
  mockApi.mockResolvedValue({
    request: {
      ...visitor,
      status: 'APPROVED',
      presence: 'EXITED',
      events: [
        {
          id: 'e1',
          type: 'ENTRY',
          gate: visitor.gate,
          at: new Date().toISOString(),
        },
        {
          id: 'e2',
          type: 'EXIT',
          gate: visitor.gate,
          at: new Date().toISOString(),
        },
      ],
    },
    serverNow: new Date().toISOString(),
  });
  show('ADMIN');
  await screen.findByText('Visit completed');
  expect(screen.getByText('Entered')).toBeTruthy();
  expect(screen.getByText('Exited')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Mark entry' })).toBeNull();
});

it('retries an uncertain resident decision with the same intent and body', async () => {
  let attempts = 0;
  mockApi.mockImplementation(
    (path: string, _schema: unknown, body: unknown) => {
      if (body) {
        attempts++;
        return attempts === 1
          ? Promise.reject(new Error('Connection lost'))
          : Promise.resolve({ requestId: 'r1', version: 2 });
      }
      return Promise.resolve({
        request: visitor,
        serverNow: new Date().toISOString(),
      });
    },
  );
  show();
  await screen.findByText('A Guest');
  fireEvent.press(screen.getByRole('button', { name: 'Approve visitor' }));
  fireEvent.press(screen.getByRole('button', { name: 'Confirm action' }));
  await screen.findByText('Connection lost');
  const retry = await screen.findByRole('button', {
    name: 'Retry same action',
  });
  fireEvent.press(retry);
  await waitFor(() =>
    expect(mockApi.mock.calls.filter((c) => c[2])).toHaveLength(2),
  );
  const calls = mockApi.mock.calls.filter((c) => c[2]);
  expect(calls[0][2]).toEqual(calls[1][2]);
});
it('disables cached decision controls when offline', async () => {
  const rendered = show();
  await screen.findByText('A Guest');
  mockOnline = false;
  rendered.rerender(
    <QueryClientProvider client={rendered.client}>
      <VisitDetail userId="u1" societyId="s1" id="r1" view="RESIDENT" />
    </QueryClientProvider>,
  );
  expect(screen.getByText('A Guest')).toBeTruthy();
  // Previously cached data must not provide an enabled admission decision.
  expect(
    screen.queryByRole('button', { name: 'Approve visitor', disabled: false }),
  ).toBeNull();
  mockOnline = true;
});

it('renders the guard queue without raw native text', async () => {
  mockApi.mockResolvedValue({
    items: [visitor],
    nextCursor: null,
    serverNow: new Date().toISOString(),
  });
  const rendered = render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <VisitorQueue userId="u1" societyId="s1" view="GUARD" />
    </QueryClientProvider>,
  );
  await screen.findByText('A Guest');
  function check(node: ReturnType<typeof rendered.toJSON>) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(check);
    for (const child of node.children ?? []) {
      if (typeof child === 'string') expect(node.type).toBe('Text');
      else check(child);
    }
  }
  check(rendered.toJSON());
  expect(screen.getByRole('button', { name: 'Register visitor' })).toBeTruthy();
});
it('validates guard registration and preserves an uncertain submission for retry', async () => {
  let attempts = 0;
  mockApi.mockImplementation(
    (_path: string, _schema: unknown, body: unknown) => {
      if (body) {
        attempts++;
        return attempts === 1
          ? Promise.reject(new Error('Network lost'))
          : Promise.resolve({ requestId: 'r1', version: 1 });
      }
      return Promise.resolve({
        gates: [visitor.gate],
        flats: [visitor.flat],
        assignments: [],
        serverNow: new Date().toISOString(),
      });
    },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false, gcTime: 0 },
          },
        })
      }
    >
      <Registration userId="u1" societyId="s1" />
    </QueryClientProvider>,
  );
  await screen.findByRole('radio', { name: 'A · 101' });
  fireEvent.press(
    screen.getByRole('button', { name: 'Send approval request' }),
  );
  await screen.findByText(
    'Enter the visitor’s name and select their gate and destination flat.',
  );
  expect(mockApi.mock.calls.filter((c) => c[2])).toHaveLength(0);
  fireEvent.changeText(screen.getByLabelText('Visitor name'), 'A Guest');
  fireEvent.press(screen.getByRole('radio', { name: 'A · 101' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Send approval request' }),
  );
  await screen.findByText('Network lost');
  fireEvent.press(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.filter((c) => c[2])).toHaveLength(2),
  );
  const calls = mockApi.mock.calls.filter((c) => c[2]);
  expect(calls[0][2]).toEqual(calls[1][2]);
  for (const call of mockApi.mock.calls) expect(call[4]).toBe('u1');
});
it('lets an admin choose an existing verified email and gate without choosing a public role', async () => {
  mockApi.mockImplementation((_path: string, _schema: unknown, body: unknown) =>
    Promise.resolve(
      body
        ? { id: 'assignment1' }
        : {
            gates: [visitor.gate],
            flats: [],
            assignments: [],
            serverNow: new Date().toISOString(),
          },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false, gcTime: 0 },
          },
        })
      }
    >
      <AdminGates userId="admin" societyId="s1" />
    </QueryClientProvider>,
  );
  await screen.findByText('No guards assigned yet.');
  fireEvent.changeText(
    screen.getByLabelText('Guard email'),
    'guard@example.com',
  );
  fireEvent.press(screen.getByRole('radio', { name: 'Main gate' }));
  fireEvent.press(screen.getByRole('button', { name: 'Assign guard' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/societies/s1/gate/admin/assignments',
      expect.anything(),
      { email: 'guard@example.com', gateId: 'g1' },
      undefined,
      'admin',
    ),
  );
  for (const call of mockApi.mock.calls) expect(call[4]).toBe('admin');
});

it('binds gate creation and assignment removal to the displayed admin', async () => {
  mockApi.mockImplementation((_path: string, _schema: unknown, body: unknown) =>
    Promise.resolve(
      body
        ? { id: 'g1', name: 'Main gate' }
        : {
            gates: [visitor.gate],
            flats: [],
            assignments: [
              {
                id: 'assignment1',
                gate: visitor.gate,
                name: 'Gate guard',
                email: 'guard@example.com',
                active: true,
              },
            ],
            serverNow: new Date().toISOString(),
          },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false, gcTime: 0 },
          },
        })
      }
    >
      <AdminGates userId="admin" societyId="s1" />
    </QueryClientProvider>,
  );
  await screen.findByText('Gate guard');
  fireEvent.changeText(screen.getByLabelText('New gate name'), 'Side gate');
  fireEvent.press(screen.getByRole('button', { name: 'Add gate' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/societies/s1/gate/admin/gates',
      expect.anything(),
      { name: 'Side gate' },
      undefined,
      'admin',
    ),
  );
  fireEvent.press(
    screen.getByRole('button', {
      name: 'Remove guard@example.com from Main gate',
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/societies/s1/gate/admin/assignments/assignment1/revoke',
      expect.anything(),
      {},
      undefined,
      'admin',
    ),
  );
});

it('binds guest pass setup and creation to the resident who opened the form', async () => {
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/setup')
        ? { flats: [visitor.flat], serverNow: new Date().toISOString() }
        : { passId: 'p1', version: 1 },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false, gcTime: 0 },
          },
        })
      }
    >
      <PassCreate userId="resident-a" societyId="s1" />
    </QueryClientProvider>,
  );
  await screen.findByRole('radio', { name: 'A · 101' });
  fireEvent.changeText(screen.getByLabelText('Guest name'), 'Invited guest');
  fireEvent.press(screen.getByRole('button', { name: 'Create guest pass' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.some((call) => call[0].endsWith('/passes'))).toBe(
      true,
    ),
  );
  for (const call of mockApi.mock.calls) expect(call[4]).toBe('resident-a');
});

it('binds guest verification and entry to the guard who inspected the code', async () => {
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  AppState.currentState = 'active';
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/setup')
        ? { gates: [visitor.gate], serverNow: new Date().toISOString() }
        : path.endsWith('/verify')
          ? {
              pass: {
                id: 'p1',
                version: 1,
                visitorName: 'Invited guest',
                flat: visitor.flat,
                status: 'READY',
                presence: 'NOT_ENTERED',
                events: [],
                validFrom: new Date(Date.now() - 60000).toISOString(),
                validUntil: new Date(Date.now() + 3600000).toISOString(),
              },
              serverNow: new Date().toISOString(),
            }
          : { passId: 'p1', version: 2 },
    ),
  );
  try {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: 0 },
              mutations: { retry: false, gcTime: 0 },
            },
          })
        }
      >
        <PassVerify userId="guard-a" societyId="s1" />
      </QueryClientProvider>,
    );
    await screen.findByRole('radio', { name: 'Main gate' });
    fireEvent.changeText(
      screen.getByLabelText('Guest pass code'),
      'ABCDEFGHJKMNPQRS',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
    await screen.findByText('Invited guest');
    fireEvent.press(screen.getByRole('button', { name: 'Record guest entry' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm guest entry' }),
    );
    await waitFor(() =>
      expect(
        mockApi.mock.calls.some((call) => call[0].endsWith('/entry')),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Guest pass code').props.value).toBe(''),
    );
    for (const call of mockApi.mock.calls) expect(call[4]).toBe('guard-a');
  } finally {
    listener.mockRestore();
  }
});

it('hides cached visitor details after an authoritative refresh fails', async () => {
  show();
  await screen.findByText('A Guest');
  mockApi.mockRejectedValue(new Error('Access no longer available'));
  fireEvent.press(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Access no longer available');
  expect(screen.queryByText('A Guest')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve visitor' })).toBeNull();
});
it('hides cached queue cards after access is revoked', async () => {
  mockApi.mockResolvedValue({ items: [visitor], nextCursor: null });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <VisitorQueue userId="u1" societyId="s1" view="RESIDENT" />
    </QueryClientProvider>,
  );
  await screen.findByText('A Guest');
  mockApi.mockRejectedValue(new Error('Access no longer available'));
  fireEvent.press(screen.getByRole('button', { name: 'Refresh visitors' }));
  await screen.findByText('Access no longer available');
  expect(screen.queryByText('A Guest')).toBeNull();
});

it('uses the same resident queue for home and hides its cached summary after a read fails', async () => {
  mockApi.mockResolvedValue({ items: [visitor], nextCursor: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <VisitorQueue
        userId="u1"
        societyId="s1"
        view="RESIDENT"
        presentation="summary"
      />
    </QueryClientProvider>,
  );
  await screen.findByText('A Guest is at the gate.');
  expect(
    screen.getByRole('button', { name: 'Review visitor request' }),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Approve visitor' })).toBeNull();
  expect(mockApi.mock.calls[0][0]).toBe(
    '/societies/s1/gate/requests?view=RESIDENT&filter=WAITING',
  );
  mockApi.mockRejectedValue(new Error('Access removed'));
  await client.refetchQueries();
  await screen.findByText('Access removed');
  expect(screen.queryByText('A Guest is at the gate.')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Review visitor request' }),
  ).toBeNull();
});

it('keeps external History navigation and local queue filters synchronized', async () => {
  mockApi.mockResolvedValue({ items: [], nextCursor: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const change = jest.fn();
  const queue = (filter: 'HISTORY' | 'WAITING') => (
    <QueryClientProvider client={client}>
      <VisitorQueue
        userId="guard"
        societyId="society"
        view="GUARD"
        activeFilter={filter}
        onFilterChange={change}
      />
    </QueryClientProvider>
  );
  const view = render(queue('HISTORY'));
  await screen.findByText('No past visits yet');
  fireEvent.press(screen.getByRole('tab', { name: 'Waiting' }));
  expect(change).toHaveBeenCalledWith('WAITING');
  view.rerender(queue('WAITING'));
  await screen.findByText('No visitors waiting');
  expect(
    screen.getByRole('tab', { name: 'Waiting', selected: true }),
  ).toBeTruthy();
  view.rerender(queue('HISTORY'));
  await screen.findByText('No past visits yet');
  expect(
    mockApi.mock.calls.some((call) =>
      call[0].endsWith('view=GUARD&filter=HISTORY'),
    ),
  ).toBe(true);
});
