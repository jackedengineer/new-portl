import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DirectoryBoard } from '../features/administration/directory';
import { DirectoryEditor } from '../features/administration/directory-editor';
import { SocietyResidents } from '../features/administration/residents';
import { SocietyStructure } from '../features/administration/structure';
const mockApi = jest.fn();
let mockOnline = true;
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  messageOf: (e: Error) => e.message,
  successSchema: {},
}));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('../features/gate/live', () => ({
  useLiveGate: () => ({
    enabled: false,
    online: mockOnline,
    clock: Date.now(),
  }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
}));
const entry = {
  id: 'entry',
  name: 'Synthetic plumber',
  kind: 'SERVICE_PROVIDER' as const,
  service: 'Plumbing',
  description: 'By appointment',
  phone: null,
  sharePhone: false,
  archived: false,
  version: 1,
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
  mockOnline = true;
});
it('shows a resident directory without editing controls and binds requests to the identity', async () => {
  mockApi.mockResolvedValue({ items: [entry], nextCursor: null });
  const v = show(
    <DirectoryBoard userId="resident" societyId="society" view="RESIDENT" />,
  );
  await screen.findByText(entry.name);
  expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: `Edit ${entry.name}` }),
  ).toBeNull();
  expect(screen.getByText('No phone number shared')).toBeTruthy();
  expect(mockApi.mock.calls[0][4]).toBe('resident');
  v.unmount();
  v.client.clear();
});
it('requires a valid phone before explicit sharing and preserves an edit version', async () => {
  mockApi.mockResolvedValue({ success: true });
  const close = jest.fn();
  const v = show(
    <DirectoryEditor
      userId="admin"
      societyId="society"
      item={entry}
      onClose={close}
    />,
  );
  fireEvent.press(
    screen.getByRole('checkbox', {
      name: 'Share this phone number with residents',
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Save contact' }));
  expect(mockApi).not.toHaveBeenCalled();
  fireEvent.changeText(
    screen.getByLabelText('Phone number (optional)'),
    '+919000000001',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Save contact' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(mockApi.mock.calls[0][2]).toMatchObject({
    sharePhone: true,
    phone: '+919000000001',
    expectedVersion: 1,
  });
  v.unmount();
  v.client.clear();
});
it('requires an explicit residency-end confirmation and keeps a stale command visible', async () => {
  const resident = {
    id: 'occupancy',
    userId: 'resident',
    name: 'Synthetic Resident',
    email: 'resident@example.invalid',
    flatId: 'flat',
    flat: '101',
    tower: 'A',
    relationship: 'TENANT',
    startedAt: '2026-10-10T00:00:00.000Z',
    endedAt: null,
  };
  mockApi.mockImplementation(
    (_path: unknown, _schema: unknown, body: unknown) =>
      body
        ? Promise.reject(
            new Error('This residency changed. Refresh before ending it.'),
          )
        : Promise.resolve({ items: [resident], nextCursor: null }),
  );
  const v = show(<SocietyResidents userId="admin" societyId="society" />);
  await screen.findByText(resident.name);
  fireEvent.press(
    screen.getByRole('button', { name: `End residency for ${resident.name}` }),
  );
  expect(mockApi.mock.calls.filter((c) => c[2])).toHaveLength(0);
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm end residency' }),
  );
  await screen.findByText('This residency changed. Refresh before ending it.');
  expect(mockApi.mock.calls.find((c) => c[2])?.[2]).toEqual({
    expectedStartedAt: resident.startedAt,
  });
  expect(screen.getByRole('button', { name: 'Keep residency' })).toBeTruthy();
  v.unmount();
  v.client.clear();
});
it('does not complete an old editor after it unmounts or retain its request authority', async () => {
  let finish!: (value: object) => void;
  mockApi.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const close = jest.fn(),
    v = show(
      <DirectoryEditor
        userId="old-admin"
        societyId="society"
        item={entry}
        onClose={close}
      />,
    );
  fireEvent.press(screen.getByRole('button', { name: 'Save contact' }));
  await waitFor(() => expect(mockApi).toHaveBeenCalled());
  const signal = mockApi.mock.calls[0][3] as AbortSignal;
  v.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ success: true }));
  expect(close).not.toHaveBeenCalled();
  v.client.clear();
});
it('hides previously cached contact data when a refresh loses access', async () => {
  mockApi.mockResolvedValue({
    items: [{ ...entry, phone: '+919000000001', sharePhone: true }],
    nextCursor: null,
  });
  const v = show(
    <DirectoryBoard userId="resident" societyId="society" view="RESIDENT" />,
  );
  await screen.findByText('+919000000001');
  mockApi.mockRejectedValue(new Error('Current resident access is required'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh directory contacts' }),
  );
  await screen.findByText('Current resident access is required');
  expect(screen.queryByText('+919000000001')).toBeNull();
  v.unmount();
  v.client.clear();
});
it('disables destructive actions offline and permits refreshing an empty directory', async () => {
  mockOnline = false;
  mockApi.mockResolvedValue({ items: [entry], nextCursor: null });
  const v = show(
    <DirectoryBoard userId="admin" societyId="society" view="ADMIN" />,
  );
  await screen.findByText(entry.name);
  expect(
    screen.getByRole('button', { name: 'Add contact' }).props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: `Archive ${entry.name}` }).props
      .accessibilityState.disabled,
  ).toBe(true);
  v.unmount();
  v.client.clear();
});
it('validates a tower form and uses a stable creation identifier', async () => {
  mockApi.mockImplementation((_p: unknown, _s: unknown, body: unknown) =>
    Promise.resolve(body ? { success: true } : { items: [], nextCursor: null }),
  );
  const v = show(<SocietyStructure userId="admin" societyId="society" />);
  await screen.findByText('No towers match this view.');
  fireEvent.press(screen.getByRole('button', { name: 'Add tower' }));
  fireEvent.press(screen.getByRole('button', { name: 'Save tower' }));
  expect(mockApi.mock.calls.filter((c) => c[2])).toHaveLength(0);
  fireEvent.changeText(screen.getByLabelText('Tower name'), 'North');
  fireEvent.press(screen.getByRole('button', { name: 'Save tower' }));
  await waitFor(() =>
    expect(mockApi.mock.calls.find((c) => c[2])?.[2]).toEqual({
      id: 'f4f08dfb-c6fc-44d4-8393-4b131b653b5a',
      name: 'North',
    }),
  );
  v.unmount();
  v.client.clear();
});
