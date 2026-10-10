import { Text, Pressable } from 'react-native';
import { useEffect } from 'react';
import {
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
function Harness() {
  const session = useSession();
  const client = useQueryClient();
  useEffect(() => {
    clientForCleanup = client;
  }, [client]);
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
