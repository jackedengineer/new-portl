import { Text, Pressable } from 'react-native';
import { useEffect } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SessionProvider, useSession } from '../auth/session';

const mockGetSession = jest.fn();
const mockSignOut = jest.fn();
const mockApi = jest.fn();
const mockClearPush = jest.fn();
let sessionForTest: ReturnType<typeof useSession>;
let clientForCleanup: ReturnType<typeof useQueryClient>;
jest.mock('../lib/auth-client', () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    signOut: () => mockSignOut(),
  },
}));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  ApiError: class extends Error {},
}));
jest.mock('../features/notifications/native', () => ({
  clearPushState: () => mockClearPush(),
}));
beforeEach(() => mockClearPush.mockResolvedValue(undefined));
afterEach(() => clientForCleanup?.clear());
function Harness() {
  const session = useSession();
  const client = useQueryClient();
  useEffect(() => {
    clientForCleanup = client;
    sessionForTest = session;
  }, [client, session]);
  return (
    <>
      <Text>
        {session.loading
          ? 'Checking session'
          : (session.me?.user.email ?? 'Signed out')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Seed private cache"
        onPress={() =>
          client.setQueryData(['private', 'old-user'], 'private-data')
        }
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void session.signOut()}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Finish sign in"
        onPress={() => void session.signedIn()}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Inspect private cache"
        onPress={() => {
          expect(client.getQueryData(['private', 'old-user'])).toBeUndefined();
        }}
      />
    </>
  );
}
it('notifies the active session observer on logout and freshly resolves the next identity', async () => {
  mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
  mockApi.mockResolvedValue({
    user: { id: 'first', email: 'first@example.invalid' },
    memberships: [],
  });
  mockSignOut.mockResolvedValue({ data: { success: true } });
  const rendered = render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );
  await screen.findByText('first@example.invalid');
  fireEvent.press(screen.getByRole('button', { name: 'Seed private cache' }));
  fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByText('Signed out');
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  fireEvent.press(
    screen.getByRole('button', { name: 'Inspect private cache' }),
  );
  mockGetSession.mockResolvedValue({ data: { user: { id: 'second' } } });
  mockApi.mockResolvedValue({
    user: { id: 'second', email: 'second@example.invalid' },
    memberships: [],
  });
  fireEvent.press(screen.getByRole('button', { name: 'Finish sign in' }));
  await screen.findByText('second@example.invalid');
  await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
  fireEvent.press(
    screen.getByRole('button', { name: 'Inspect private cache' }),
  );
  // End the observer and interval explicitly; no production cache timers remain.
  fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByText('Signed out');
  rendered.unmount();
  clientForCleanup!.clear();
});

it('ignores a previous identity’s delayed teardown after a new sign-in', async () => {
  mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
  mockApi.mockResolvedValue({
    user: { id: 'first', email: 'first@example.invalid' },
    memberships: [],
  });
  const rendered = render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );
  await screen.findByText('first@example.invalid');
  const forgetFirst = sessionForTest.forgetSession;
  mockGetSession.mockResolvedValue({ data: { user: { id: 'second' } } });
  mockApi.mockResolvedValue({
    user: { id: 'second', email: 'second@example.invalid' },
    memberships: [],
  });
  await act(async () => sessionForTest.signedIn());
  await screen.findByText('second@example.invalid');
  const signOuts = mockSignOut.mock.calls.length;
  await act(async () => forgetFirst());
  expect(screen.getByText('second@example.invalid')).toBeTruthy();
  expect(mockSignOut).toHaveBeenCalledTimes(signOuts);
  rendered.unmount();
});
it('preserves a resolved identity through a failed refresh and clears it on authoritative sign-out', async () => {
  mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
  mockApi.mockResolvedValue({
    user: { id: 'first', email: 'first@example.invalid' },
    memberships: [],
  });
  const rendered = render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );
  await screen.findByText('first@example.invalid');
  mockGetSession.mockRejectedValueOnce(new Error('Connection lost'));
  await act(async () => sessionForTest.refresh());
  await waitFor(() => expect(sessionForTest.error).toBeTruthy());
  expect(screen.getByText('first@example.invalid')).toBeTruthy();
  mockGetSession.mockResolvedValueOnce({ data: null });
  await act(async () => sessionForTest.refresh());
  await screen.findByText('Signed out');
  expect(sessionForTest.error).toBeNull();
  rendered.unmount();
});
it('does not revoke a new sign-in that starts while local cleanup is settling', async () => {
  mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
  mockApi.mockResolvedValue({
    user: { id: 'first', email: 'first@example.invalid' },
    memberships: [],
  });
  const rendered = render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );
  await screen.findByText('first@example.invalid');
  let finish!: () => void;
  mockClearPush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let forgotten!: Promise<unknown>;
  await act(async () => {
    forgotten = sessionForTest.forgetSession();
  });
  await waitFor(() => expect(finish).toBeDefined());
  mockGetSession.mockResolvedValue({ data: { user: { id: 'second' } } });
  mockApi.mockResolvedValue({
    user: { id: 'second', email: 'second@example.invalid' },
    memberships: [],
  });
  await act(async () => sessionForTest.signedIn());
  await waitFor(() => expect(sessionForTest.me?.user.id).toBe('second'));
  expect(sessionForTest.loading).toBe(true);
  const signOuts = mockSignOut.mock.calls.length;
  await act(async () => {
    finish();
    await forgotten;
  });
  expect(screen.getByText('second@example.invalid')).toBeTruthy();
  expect(mockSignOut).toHaveBeenCalledTimes(signOuts);
  rendered.unmount();
});
it('treats an authoritative session rejection as signed out rather than a recoverable refresh error', async () => {
  mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
  mockApi.mockResolvedValue({
    user: { id: 'first', email: 'first@example.invalid' },
    memberships: [],
  });
  const rendered = render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );
  await screen.findByText('first@example.invalid');
  mockGetSession.mockResolvedValueOnce({ error: { status: 401 } });
  await act(async () => sessionForTest.refresh());
  await screen.findByText('Signed out');
  expect(sessionForTest.error).toBeNull();
  rendered.unmount();
});

it.each(['success', 'failure'] as const)(
  'blocks authentication until the native sign-out %s has settled after forgetting a session',
  async (outcome) => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
    mockApi.mockResolvedValue({
      user: { id: 'first', email: 'first@example.invalid' },
      memberships: [],
    });
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );
    await screen.findByText('first@example.invalid');
    let finish!: () => void;
    let fail!: (error: Error) => void;
    mockSignOut.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    let forgotten!: Promise<unknown>;
    await act(async () => {
      forgotten = sessionForTest.forgetSession('first');
    });
    await waitFor(() => expect(finish).toBeDefined());
    expect(sessionForTest.me).toBeNull();
    expect(sessionForTest.loading).toBe(true);
    expect(screen.queryByText('Signed out')).toBeNull();
    await act(async () => {
      if (outcome === 'success') finish();
      else fail(new Error('Connection lost'));
      await forgotten;
    });
    await screen.findByText('Signed out');
    expect(sessionForTest.loading).toBe(false);
  },
);
it.each(['earlier', 'newer'] as const)(
  'keeps authentication blocked when the %s sign-out finishes first',
  async (order) => {
    mockGetSession.mockResolvedValue({ data: { user: { id: 'first' } } });
    mockApi.mockResolvedValue({
      user: { id: 'first', email: 'first@example.invalid' },
      memberships: [],
    });
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );
    await screen.findByText('first@example.invalid');
    let finishFirst!: (value: { data: { success: boolean } }) => void;
    let finishSecond!: (value: { data: { success: boolean } }) => void;
    mockSignOut.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    mockSignOut.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => {
      first = sessionForTest.signOut();
    });
    await act(async () => {
      second = sessionForTest.signOut();
    });
    await act(async () => {
      if (order === 'earlier') {
        finishFirst({ data: { success: true } });
        await first;
      } else {
        finishSecond({ data: { success: true } });
        await second;
      }
    });
    expect(sessionForTest.loading).toBe(true);
    await act(async () => {
      if (order === 'earlier') {
        finishSecond({ data: { success: true } });
        await second;
      } else {
        finishFirst({ data: { success: true } });
        await first;
      }
    });
    await screen.findByText('Signed out');
    expect(sessionForTest.loading).toBe(false);
  },
);

it('blocks sign-out and overlapping switches while a cookie-changing account transition is pending', async () => {
  mockGetSession.mockResolvedValue({ data: { user: { id: 'review-parent' } } });
  mockApi.mockResolvedValue({
    user: { id: 'review-parent', email: 'parent@review.portl.invalid' },
    memberships: [],
  });
  const rendered = render(
    <SessionProvider>
      <Harness />
    </SessionProvider>,
  );
  await screen.findByText('parent@review.portl.invalid');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let transition!: Promise<void>;
  await act(async () => {
    transition = sessionForTest.changeAccount('review-parent', () => pending);
  });
  await screen.findByText('Checking session');
  const signOutBefore = mockSignOut.mock.calls.length;
  await expect(sessionForTest.signOut()).rejects.toThrow(
    'Please wait for the account switch',
  );
  await expect(
    sessionForTest.changeAccount('review-parent', async () => {}),
  ).rejects.toThrow('Your account changed');
  expect(mockSignOut.mock.calls.length).toBe(signOutBefore);
  mockGetSession.mockResolvedValue({ data: { user: { id: 'child' } } });
  mockApi.mockResolvedValue({
    user: { id: 'child', email: 'child@lifecycle.review.portl.invalid' },
    memberships: [],
  });
  await act(async () => {
    release();
    await transition;
  });
  await screen.findByText('child@lifecycle.review.portl.invalid');
  rendered.unmount();
});
