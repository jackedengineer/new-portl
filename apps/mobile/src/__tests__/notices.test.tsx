import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NoticeBoard } from '../features/notices/board';
import { NoticeDetail } from '../features/notices/detail';
import { NoticeEditor } from '../features/notices/editor';
import { notificationDestination } from '../features/notifications/navigation';
import { ApiError } from '../lib/api';
const mockApi = jest.fn(),
  mockPush = jest.fn(),
  mockReplace = jest.fn();
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
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useIsFocused: () => true,
}));
jest.mock('../features/gate/live', () => ({
  useLiveGate: () => ({ enabled: false, online: true, clock: Date.now() }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
}));
const notice = {
  id: 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
  societyId: 'society',
  title: 'Water supply update',
  body: 'Supply resumes at 6 pm.',
  status: 'PUBLISHED' as const,
  version: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  archivedAt: null,
};
function show(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    ),
    client,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
});
it('shows resident notices with no authoring controls and sends expected identity', async () => {
  mockApi.mockResolvedValue({ items: [notice], nextCursor: null });
  const view = show(
    <NoticeBoard userId="resident" societyId="society" view="RESIDENT" />,
  );
  await screen.findByText(notice.title);
  expect(screen.queryByRole('button', { name: 'Create notice' })).toBeNull();
  expect(mockApi.mock.calls[0]?.[4]).toBe('resident');
  fireEvent.press(screen.getByRole('button', { name: 'Read notice' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/notice',
    params: { id: notice.id, societyId: 'society', view: 'RESIDENT' },
  });
  view.unmount();
  view.client.clear();
});
it('offers admin creation and status filters', async () => {
  mockApi.mockResolvedValue({ items: [], nextCursor: null });
  const view = show(
    <NoticeBoard userId="admin" societyId="society" view="ADMIN" />,
  );
  await screen.findByText('No notices here yet.');
  fireEvent.press(screen.getByRole('tab', { name: 'Drafts' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.some((c) => c[0].includes('status=DRAFT'))).toBe(
      true,
    ),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Create notice' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/notice-editor',
    params: { societyId: 'society' },
  });
  view.unmount();
  view.client.clear();
});
it('requires an explicit publish confirmation and uses the loaded version', async () => {
  mockApi.mockImplementation((_path: string, _schema: unknown, body: unknown) =>
    Promise.resolve(
      body
        ? notice
        : { ...notice, status: 'DRAFT', version: 1, publishedAt: null },
    ),
  );
  const view = show(
    <NoticeDetail
      userId="admin"
      societyId="society"
      id={notice.id}
      view="ADMIN"
    />,
  );
  await screen.findByText(notice.body);
  fireEvent.press(screen.getByRole('button', { name: 'Publish notice' }));
  expect(mockApi.mock.calls.filter((c) => c[2] !== undefined)).toHaveLength(0);
  await screen.findByText(/Every current resident/);
  fireEvent.press(screen.getByRole('button', { name: 'Confirm publish' }));
  await waitFor(() =>
    expect(
      mockApi.mock.calls.some(
        (c) => c[0].endsWith('/publish') && c[2].expectedVersion === 1,
      ),
    ).toBe(true),
  );
  view.unmount();
  view.client.clear();
});
it('renders resident detail as plain text without edit or archive actions', async () => {
  mockApi.mockResolvedValue({
    ...notice,
    body: '<script>literal text</script>',
  });
  const view = show(
    <NoticeDetail
      userId="resident"
      societyId="society"
      id={notice.id}
      view="RESIDENT"
    />,
  );
  await screen.findByText('<script>literal text</script>');
  expect(screen.queryByRole('button', { name: 'Archive notice' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull();
  view.unmount();
  view.client.clear();
});
it('retains a create identity and entered text after a network failure', async () => {
  mockApi.mockRejectedValue(new Error('Connection failed'));
  const view = show(<NoticeEditor userId="admin" societyId="society" />);
  fireEvent.changeText(screen.getByLabelText('Notice title'), 'Water update');
  fireEvent.changeText(
    screen.getByLabelText('Notice details'),
    'Tomorrow at 6 pm.',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Connection failed');
  fireEvent.press(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
  expect(mockApi.mock.calls[0]?.[2]).toEqual(mockApi.mock.calls[1]?.[2]);
  expect(screen.getByDisplayValue('Tomorrow at 6 pm.')).toBeTruthy();
  view.unmount();
  view.client.clear();
});
it('blocks late editor navigation after account unmount', async () => {
  let resolve!: (value: unknown) => void;
  mockApi.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = show(<NoticeEditor userId="admin" societyId="society" />);
  fireEvent.changeText(screen.getByLabelText('Notice title'), 'Water update');
  fireEvent.changeText(
    screen.getByLabelText('Notice details'),
    'Tomorrow at 6 pm.',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(mockApi).toHaveBeenCalled());
  view.unmount();
  resolve({ ...notice, status: 'DRAFT' });
  await new Promise((r) => setTimeout(r, 0));
  expect(mockReplace).not.toHaveBeenCalled();
  view.client.clear();
});
it('shows a retry on load failure instead of private cached detail', async () => {
  mockApi.mockRejectedValue(new Error('Notice no longer available'));
  const view = show(
    <NoticeDetail
      userId="resident"
      societyId="society"
      id={notice.id}
      view="RESIDENT"
    />,
  );
  await screen.findByText('Notice no longer available');
  expect(screen.getByRole('button', { name: 'Retry notice' })).toBeTruthy();
  expect(screen.queryByText(notice.body)).toBeNull();
  view.unmount();
  view.client.clear();
});
it('routes an authorized notice tap to a fixed notice screen', async () => {
  expect(
    await notificationDestination({ notificationId: notice.id }, async () => ({
      id: notice.id,
      societyId: 'society',
      resourceId: notice.id,
      resourceKind: 'NOTICE',
      view: 'RESIDENT',
      type: 'NOTICE_PUBLISHED',
      createdAt: notice.createdAt,
      readAt: null,
    })),
  ).toEqual({
    pathname: '/notice',
    params: { id: notice.id, societyId: 'society', view: 'RESIDENT' },
  });
});
it('keeps the draft edit version bound to the text the admin started editing', async () => {
  mockApi.mockResolvedValue({
    ...notice,
    status: 'DRAFT',
    version: 1,
    publishedAt: null,
  });
  const view = show(
    <NoticeEditor userId="admin" societyId="society" id={notice.id} />,
  );
  await screen.findByDisplayValue(notice.title);
  fireEvent.changeText(
    screen.getByLabelText('Notice details'),
    'My local edits',
  );
  await act(async () => {
    view.client.setQueryData(
      ['notices', 'admin', 'society', 'edit', notice.id],
      {
        ...notice,
        status: 'DRAFT',
        version: 2,
        title: 'Another admin update',
        publishedAt: null,
      },
    );
  });
  await screen.findByText(/A newer draft is available/);
  mockApi.mockRejectedValue(
    new Error('This notice changed. Refresh it before trying again.'),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/This notice changed/);
  const mutation = mockApi.mock.calls.find((c) => c[2] !== undefined);
  expect(mutation?.[2]).toEqual({
    title: notice.title,
    body: 'My local edits',
    expectedVersion: 1,
  });
  expect(screen.getByDisplayValue('My local edits')).toBeTruthy();
  view.unmount();
  view.client.clear();
});
it('keeps publish confirmation bound to the version the admin reviewed', async () => {
  mockApi.mockResolvedValue({
    ...notice,
    status: 'DRAFT',
    version: 1,
    publishedAt: null,
  });
  const view = show(
    <NoticeDetail
      userId="admin"
      societyId="society"
      id={notice.id}
      view="ADMIN"
    />,
  );
  await screen.findByText(notice.body);
  fireEvent.press(screen.getByRole('button', { name: 'Publish notice' }));
  await act(async () => {
    view.client.setQueryData(
      ['notices', 'admin', 'society', 'detail', notice.id, 'ADMIN'],
      {
        ...notice,
        title: 'Another admin update',
        status: 'DRAFT',
        version: 2,
        publishedAt: null,
      },
    );
  });
  await screen.findByText('Another admin update');
  fireEvent.press(screen.getByRole('button', { name: 'Confirm publish' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.some((c) => c[0].endsWith('/publish'))).toBe(
      true,
    ),
  );
  expect(
    mockApi.mock.calls.find((c) => c[0].endsWith('/publish'))?.[2],
  ).toEqual({ expectedVersion: 1 });
  view.unmount();
  view.client.clear();
});
it('preserves unsaved draft text across a failed background refetch and retry', async () => {
  mockApi.mockResolvedValue({
    ...notice,
    status: 'DRAFT',
    version: 1,
    publishedAt: null,
  });
  const view = show(
    <NoticeEditor userId="admin" societyId="society" id={notice.id} />,
  );
  await screen.findByDisplayValue(notice.title);
  fireEvent.changeText(
    screen.getByLabelText('Notice details'),
    'Unsaved local text',
  );
  mockApi.mockRejectedValue(new Error('Connection lost'));
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: ['notices', 'admin', 'society', 'edit', notice.id],
    });
  });
  await screen.findByText('Connection lost');
  expect(screen.queryByDisplayValue('Unsaved local text')).toBeTruthy();
  mockApi.mockResolvedValue({
    ...notice,
    status: 'DRAFT',
    version: 1,
    publishedAt: null,
  });
  fireEvent.press(screen.getByRole('button', { name: 'Retry draft' }));
  await waitFor(() => expect(screen.queryByText('Connection lost')).toBeNull());
  expect(screen.getByDisplayValue('Unsaved local text')).toBeTruthy();
  view.unmount();
  view.client.clear();
});
it('hides the open draft if a background refetch revokes access', async () => {
  mockApi.mockResolvedValue({
    ...notice,
    status: 'DRAFT',
    version: 1,
    publishedAt: null,
  });
  const view = show(
    <NoticeEditor userId="admin" societyId="society" id={notice.id} />,
  );
  await screen.findByDisplayValue(notice.title);
  fireEvent.changeText(
    screen.getByLabelText('Notice details'),
    'Private unsaved text',
  );
  mockApi.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Access revoked'));
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: ['notices', 'admin', 'society', 'edit', notice.id],
    });
  });
  await screen.findByText('Access revoked');
  expect(screen.queryByDisplayValue('Private unsaved text')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  view.unmount();
  view.client.clear();
});
