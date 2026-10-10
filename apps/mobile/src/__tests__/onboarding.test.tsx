import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import Community from '../app/(member)/community';
import Invitation from '../app/(member)/invitation';
import { AdminReviews } from '../features/onboarding/admin-reviews';
import { AdminStepUp } from '../features/onboarding/admin-step-up';
import { AdminInvitations } from '../features/onboarding/admin-invitations';

const mockApi = jest.fn();
const mockRefresh = jest.fn();
const mockReplace = jest.fn();
const mockVerify = jest.fn();
const mockMe = {
  user: { id: 'u1', email: 'a@example.com' },
  memberships: [],
  adminAuthenticatorConfigured: true,
};
jest.mock('../auth/session', () => ({
  useSession: () => ({ me: mockMe, refresh: mockRefresh, signOut: jest.fn() }),
}));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  messageOf: (e: Error) => e.message,
  successSchema: {},
}));
jest.mock('../lib/auth-client', () => ({
  authClient: {
    twoFactor: { verifyTotp: (...args: unknown[]) => mockVerify(...args) },
  },
}));
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: jest.fn(),
    canGoBack: () => false,
  },
  Redirect: () => null,
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const society = { id: 's1', name: 'Portl Gardens', isDemo: true };
const flat = { id: 'f1', tower: 'A', label: '101' };
const pending = {
  id: 'app1',
  society,
  flat,
  name: 'A Resident',
  relationship: 'TENANT',
  status: 'PENDING',
  reason: null,
  createdAt: '2026-10-10T10:00:00Z',
};
function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}
beforeEach(() => {
  mockRefresh.mockResolvedValue(undefined);
  mockVerify.mockResolvedValue({ data: {} });
});
it('shows pending status without a society dashboard and permits withdrawal', async () => {
  mockApi.mockResolvedValue({ items: [pending], nextCursor: null });
  renderWithQuery(<Community />);
  await screen.findByText('Awaiting review');
  expect(screen.queryByText('Manage resident onboarding')).toBeNull();
  expect(screen.queryByText('Society access active')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Withdraw application' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/onboarding/applications/app1/withdraw',
      expect.anything(),
      {},
    ),
  );
});
it('previews the invited flat and requires explicit acceptance', async () => {
  mockApi.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('preview')
        ? {
            society,
            flat,
            relationship: 'TENANT',
            expiresAt: '2026-10-17T10:00:00Z',
          }
        : { societyId: 's1' },
    ),
  );
  renderWithQuery(<Invitation />);
  fireEvent.changeText(
    screen.getByLabelText('Invitation code'),
    'A'.repeat(43),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Check invitation' }));
  await screen.findByRole('button', { name: 'Accept & join society' });
  expect(mockRefresh).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByRole('button', { name: 'Accept & join society' }),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/community'));
  expect(mockApi).toHaveBeenCalledWith(
    '/onboarding/invitation-accept',
    expect.anything(),
    { token: 'A'.repeat(43) },
  );
});
it('requires confirmation before an admin approval', async () => {
  mockApi.mockResolvedValue({ items: [pending], nextCursor: null });
  renderWithQuery(<AdminReviews userId="admin" societyId="s1" />);
  await screen.findByText('A Resident');
  fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
  expect(mockApi.mock.calls.some((call) => call[0].endsWith('decision'))).toBe(
    false,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Confirm approval' }));
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(
      '/societies/s1/admin/applications/app1/decision',
      expect.anything(),
      { decision: 'APPROVE' },
    ),
  );
});
it('uses the authenticator without trusted-device or email fallback', async () => {
  render(<AdminStepUp societyName="Portl Gardens" />);
  fireEvent.changeText(screen.getByLabelText('Authenticator code'), '123456');
  fireEvent.press(screen.getByRole('button', { name: 'Verify admin access' }));
  await waitFor(() =>
    expect(mockVerify).toHaveBeenCalledWith({
      code: '123456',
      trustDevice: false,
    }),
  );
  expect(mockRefresh).toHaveBeenCalled();
});
it('renders invitation management without raw native text and shows the one-time code', async () => {
  mockApi.mockImplementation((path: string, _schema: unknown, body: unknown) =>
    Promise.resolve(
      path.endsWith('/flats')
        ? { flats: [flat] }
        : body
          ? { token: 'B'.repeat(43), expiresAt: '2026-10-17T10:00:00Z' }
          : { items: [], nextCursor: null },
    ),
  );
  const rendered = renderWithQuery(
    <AdminInvitations
      userId="admin"
      societyId="s1"
      societyName="Portl Gardens"
    />,
  );
  await screen.findByText('No invitations yet.');
  // Native hosts reject text children outside a Text component. The test renderer
  // itself accepts them, so inspect the host tree to exercise that native rule.
  function assertNativeText(node: ReturnType<typeof rendered.toJSON>) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(assertNativeText);
    for (const child of node.children ?? []) {
      if (typeof child === 'string') expect(node.type).toBe('Text');
      else assertNativeText(child);
    }
  }
  assertNativeText(rendered.toJSON());
  fireEvent.changeText(
    screen.getByLabelText('Resident email'),
    'invitee@example.com',
  );
  fireEvent.press(screen.getByRole('radio', { name: 'A · 101' }));
  fireEvent.press(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText('B'.repeat(43));
  expect(mockApi).toHaveBeenCalledWith(
    '/societies/s1/admin/invitations',
    expect.anything(),
    {
      email: 'invitee@example.com',
      flatId: 'f1',
      relationship: 'TENANT',
    },
  );
});
