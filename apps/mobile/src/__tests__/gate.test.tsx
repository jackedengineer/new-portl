import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VisitorQueue } from '../features/gate/visitor-queue';
import { Registration } from '../features/gate/registration';
import { AdminGates } from '../features/gate/admin-gates';
import { VisitDetail } from '../features/gate/visit-detail';
jest.mock('../features/gate/socket', () => ({ useGateSocket: () => true }));
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
    ),
  );
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
