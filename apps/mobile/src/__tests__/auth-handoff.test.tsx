import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Me } from '@portl/contracts';
import { SessionProvider, useSession } from '../auth/session';
import Verify from '../app/(public)/verify';
import Index from '../app/index';

const mockGetSession = jest.fn();
const mockVerify = jest.fn();
const mockApi = jest.fn();
const mockNavigation = jest.fn();
let clientForCleanup: QueryClient | undefined;
let sessionForTest: ReturnType<typeof useSession>;

jest.mock('expo-router', () => ({
  router: {
    replace: (href: string) => mockNavigation(href),
    canGoBack: () => false,
  },
  Redirect: ({ href }: { href: string }) => {
    const React = jest.requireActual('react');
    React.useEffect(() => {
      mockNavigation(href);
    }, [href]);
    return null;
  },
}));
jest.mock('../lib/auth-client', () => ({
  authClient: {
    getSession: () => mockGetSession(),
    signIn: { emailOtp: (...args: unknown[]) => mockVerify(...args) },
  },
}));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  messageOf: (error: Error) => error.message,
  ApiError: class extends Error {},
}));
jest.mock('../features/notifications/native', () => ({
  clearPushState: async () => {},
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

function AuthHandoff() {
  const session = useSession();
  const client = useQueryClient();
  const [verifying, setVerifying] = useState(false);
  useEffect(() => {
    clientForCleanup = client;
    sessionForTest = session;
  }, [client, session]);
  // Public verification is replaced by the authenticated index when identity
  // arrives, just as the protected route groups do in the root layout.
  if (session.me) return <Index />;
  if (verifying) return <Verify />;
  return (
    <>
      <Text>{session.resolved ? 'Ready to sign in' : 'Checking session'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open email verification"
        onPress={() => {
          session.setChallenge({
            email: 'resident@example.invalid',
            sentAt: Date.now(),
          });
          setVerifying(true);
        }}
      />
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const residentIdentity: Me = {
  user: {
    id: 'resident',
    email: 'resident@example.invalid',
    name: 'Test resident',
    emailVerified: true,
  },
  memberships: [],
  onboardingRequired: true,
  policyRequired: false,
  adminAssuredUntil: null,
  adminAuthenticatorConfigured: false,
};

beforeEach(() => {
  mockGetSession.mockReset();
  mockApi.mockReset();
  mockVerify.mockReset();
  mockNavigation.mockClear();
  mockGetSession
    .mockResolvedValueOnce({ data: null })
    .mockResolvedValue({ data: { user: { id: 'resident' } } });
  mockVerify.mockResolvedValue({ data: { user: { id: 'resident' } } });
});
afterEach(() => clientForCleanup?.clear());

async function startVerification() {
  render(
    <SessionProvider>
      <AuthHandoff />
    </SessionProvider>,
  );
  await screen.findByText('Ready to sign in');
  fireEvent.press(
    screen.getByRole('button', { name: 'Open email verification' }),
  );
  fireEvent.changeText(screen.getByLabelText('Six-digit email code'), '123456');
  fireEvent.press(screen.getByRole('button', { name: 'Verify & continue' }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
}

it('keeps the OTP screen pending instead of redirecting to login while identity is being resolved', async () => {
  const identity = deferred<Me>();
  mockApi.mockReturnValue(identity.promise);
  await startVerification();

  const pendingNavigation = [...mockNavigation.mock.calls];
  const pendingFieldEditable = screen.queryByLabelText('Six-digit email code')
    ?.props.editable;

  await act(async () => {
    identity.resolve(residentIdentity);
  });
  await waitFor(() => expect(sessionForTest.me?.user.id).toBe('resident'));
  await waitFor(() =>
    expect(mockNavigation).toHaveBeenCalledWith('/community'),
  );
  expect(pendingNavigation).not.toContainEqual(['/login']);
  expect(pendingFieldEditable).toBe(false);
  expect(mockNavigation).not.toHaveBeenCalledWith('/login');
});

it.each(['policy acceptance', 'disposable review lifecycle'])(
  'enters account instead of racing into community when the identity requires %s',
  async (requirement) => {
    const identity = deferred<Me>();
    mockApi.mockReturnValue(identity.promise);
    await startVerification();

    await act(async () => {
      identity.resolve({
        ...residentIdentity,
        policyRequired: requirement === 'policy acceptance',
        reviewLifecycle:
          requirement === 'disposable review lifecycle'
            ? {
                purpose: 'deletion',
                nextEmail: 'replacement@lifecycle.review.portl.invalid',
                expiresAt: '2026-10-17T15:00:00.000Z',
              }
            : null,
      });
    });

    await waitFor(() =>
      expect(mockNavigation).toHaveBeenCalledWith('/account'),
    );
    expect(mockNavigation).not.toHaveBeenCalledWith('/login');
    expect(mockNavigation).not.toHaveBeenCalledWith('/community');
  },
);

it('preserves the verification challenge and offers a retry when resolving identity fails after accepted OTP', async () => {
  const identity = deferred<Me>();
  mockApi.mockReturnValueOnce(identity.promise);
  await startVerification();
  await act(async () => identity.reject(new Error('Connection lost')));
  await waitFor(() => expect(sessionForTest.error).toBeTruthy());

  expect(mockNavigation).not.toHaveBeenCalledWith('/login');
  expect(mockNavigation).not.toHaveBeenCalledWith('/community');
  expect(screen.getByText('Connection lost')).toBeTruthy();
  expect(screen.getByLabelText('Six-digit email code').props.value).toBe(
    '123456',
  );
  expect(
    screen.getByRole('button', { name: 'Verify & continue' }).props
      .accessibilityState.disabled,
  ).toBe(false);
});
