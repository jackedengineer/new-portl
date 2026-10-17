import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Reviewer from '../app/(public)/reviewer';
import { AdminStepUp } from '../features/onboarding/admin-step-up';
const mockFetch = jest.fn(),
  mockSignedIn = jest.fn(),
  mockRefresh = jest.fn(),
  mockReplace = jest.fn();
let mockMe: {
  user: { id: string };
  reviewer?: { societyId: string; role: string };
  adminAuthenticatorConfigured: boolean;
};
jest.mock('../auth/session', () => ({
  useSession: () => ({
    me: mockMe,
    signedIn: mockSignedIn,
    refresh: mockRefresh,
  }),
}));
jest.mock('../lib/auth-client', () => ({
  authClient: { $fetch: (...args: unknown[]) => mockFetch(...args) },
}));
jest.mock('../lib/api', () => ({ messageOf: (e: Error) => e.message }));
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => false,
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
beforeEach(() => {
  mockMe = {
    user: { id: 'review-admin' },
    reviewer: { societyId: 'review', role: 'ADMIN' },
    adminAuthenticatorConfigured: false,
  };
  mockFetch.mockResolvedValue({ data: { success: true } });
  mockSignedIn.mockResolvedValue(undefined);
  mockRefresh.mockResolvedValue(undefined);
});
it('requires explicit acceptance and shared-account acknowledgement, then verifies server identity', async () => {
  render(<Reviewer />);
  fireEvent.press(screen.getByRole('tab', { name: 'Security guard' }));
  fireEvent.changeText(
    screen.getByLabelText('Review access key'),
    'a'.repeat(43),
  );
  const submit = screen.getByRole('button', {
    name: 'Enter fictional society',
  });
  expect(submit.props.accessibilityState.disabled).toBe(true);
  for (const checkbox of screen.getAllByRole('checkbox'))
    fireEvent.press(checkbox);
  fireEvent.press(submit);
  await waitFor(() => expect(mockSignedIn).toHaveBeenCalled());
  expect(mockFetch).toHaveBeenCalledWith('/reviewer/sign-in', {
    method: 'POST',
    body: {
      role: 'GUARD',
      accessKey: 'a'.repeat(43),
      reviewAcknowledged: true,
      policyAcceptance: {
        adult: true,
        termsVersion: '2026-10-14',
        privacyVersion: '2026-10-14',
      },
    },
  });
  expect(mockReplace).not.toHaveBeenCalled();
});
it('keeps failed reviewer credentials out of authenticated routes', async () => {
  mockFetch.mockResolvedValue({ error: { status: 401 } });
  render(<Reviewer />);
  fireEvent.changeText(
    screen.getByLabelText('Review access key'),
    'a'.repeat(43),
  );
  for (const checkbox of screen.getAllByRole('checkbox'))
    fireEvent.press(checkbox);
  fireEvent.press(
    screen.getByRole('button', { name: 'Enter fictional society' }),
  );
  await screen.findByText(
    'Review access is unavailable or the key is incorrect.',
  );
  expect(mockSignedIn).not.toHaveBeenCalled();
});
it('uses the server-proven admin review identity for step-up without enabling password login', async () => {
  render(<AdminStepUp societyName="Fictional society" />);
  fireEvent.changeText(
    screen.getByLabelText('Review access key'),
    'a'.repeat(43),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Verify admin access' }));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(mockFetch).toHaveBeenCalledWith('/reviewer/reauthenticate', {
    method: 'POST',
    headers: { 'x-portl-expected-user': 'review-admin' },
    body: { accessKey: 'a'.repeat(43) },
  });
});
