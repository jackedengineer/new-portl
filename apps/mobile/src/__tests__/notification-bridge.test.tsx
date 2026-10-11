import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationBridge } from '../features/notifications/bridge';
const mockApi = jest.fn(),
  mockPush = jest.fn(),
  mockClear = jest.fn();
let mockSession = {
  me: null as null | { user: { id: string } },
  loading: true,
  error: false,
};
const item = {
  id: '5665c8f4-53e4-4975-820a-0ec30daf0981',
  societyId: 'society',
  resourceId: 'request',
  resourceKind: 'REQUEST',
  view: 'RESIDENT',
  type: 'VISITOR_REQUESTED',
  createdAt: new Date().toISOString(),
  readAt: null,
};
const response = {
  notification: {
    request: {
      identifier: 'cold-start',
      content: { data: { notificationId: item.id } },
    },
  },
};
const mockNative = jest.fn(async () => ({
  clearLastNotificationResponseAsync: mockClear,
  getLastNotificationResponse: () => response,
  addNotificationReceivedListener: () => ({ remove: jest.fn() }),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  addPushTokenListener: () => ({ remove: jest.fn() }),
}));
jest.mock('../auth/session', () => ({ useSession: () => mockSession }));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('../features/notifications/native', () => ({
  nativeNotifications: () => mockNative(),
  setPushIdentity: jest.fn(),
  refreshPush: async () => {},
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { me: null, loading: true, error: false };
  mockClear.mockResolvedValue(undefined);
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <NotificationBridge />
    </QueryClientProvider>
  );
  const mounted = render(tree());
  return {
    ...mounted,
    tree,
    close: () => {
      mounted.unmount();
      client.clear();
    },
  };
}
it('retains a cold-start tap until the signed-in identity has resolved', async () => {
  mockApi.mockResolvedValue(item);
  const mounted = setup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockClear).not.toHaveBeenCalled();
  mockSession = { me: { user: { id: 'alice' } }, loading: false, error: false };
  mounted.rerender(mounted.tree());
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/visitor',
      params: { id: 'request', societyId: 'society', view: 'RESIDENT' },
    }),
  );
  expect(mockApi.mock.calls[0]?.[4]).toBe('alice');
  mounted.close();
});
it('does not navigate using an old user’s response after an account switch', async () => {
  let finish!: (value: typeof item) => void;
  mockApi.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mockSession = { me: { user: { id: 'alice' } }, loading: false, error: false };
  const mounted = setup();
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  mockSession = { me: null, loading: false, error: false };
  mounted.rerender(mounted.tree());
  finish(item);
  await waitFor(() => expect(mockClear).toHaveBeenCalled());
  expect(mockPush).not.toHaveBeenCalled();
  mounted.close();
});
