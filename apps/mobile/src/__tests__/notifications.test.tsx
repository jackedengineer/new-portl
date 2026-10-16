import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationInbox } from '../features/notifications/inbox';
import { notificationDestination } from '../features/notifications/navigation';
const mockApi = jest.fn(),
  mockPush = jest.fn();
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  messageOf: (e: Error) => e.message,
}));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useIsFocused: () => true,
}));
jest.mock('../features/notifications/native', () => ({
  pushAvailable: () => false,
  enablePush: jest.fn(),
  disablePush: jest.fn(),
  isPushEnabled: async () => false,
}));
jest.mock('../features/gate/live', () => ({
  useLiveGate: () => ({ enabled: false, online: true, clock: Date.now() }),
}));
const item = {
  id: '5665c8f4-53e4-4975-820a-0ec30daf0981',
  societyId: 'society',
  resourceId: 'request',
  resourceKind: 'REQUEST' as const,
  view: 'RESIDENT' as const,
  type: 'VISITOR_REQUESTED' as const,
  createdAt: new Date().toISOString(),
  readAt: null,
};
it('loads a private inbox and opens only the authorized, fresh destination', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/read')
        ? item
        : { items: [item], nextCursor: null, unread: 1 },
    ),
  );
  const mounted = render(
    <QueryClientProvider client={client}>
      <NotificationInbox userId="user" />
    </QueryClientProvider>,
  );
  await screen.findByText('Visitor approval needed');
  expect(screen.getByText(/Push alerts need an installed/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Open notification' }));
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/visitor',
      params: { id: 'request', societyId: 'society', view: 'RESIDENT' },
    }),
  );
  mounted.unmount();
  client.clear();
});
it('rejects arbitrary links before loading and propagates revoked access', async () => {
  const load = jest.fn().mockResolvedValue(item);
  expect(
    await notificationDestination({ url: 'portl://admin' }, load),
  ).toBeNull();
  expect(load).not.toHaveBeenCalled();
  load.mockRejectedValue(new Error('Notification no longer available'));
  await expect(
    notificationDestination({ notificationId: item.id }, load),
  ).rejects.toThrow('no longer available');
});
