import { clearPushState } from '../features/notifications/native';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { meSchema, type Me } from '@portl/contracts';
import { ApiError, api } from '../lib/api';
import { authClient } from '../lib/auth-client';

function revalidateOnAuthError(error: Error) {
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.code === 'ADMIN_STEP_UP_REQUIRED')
  )
    void queryClient.invalidateQueries({ queryKey: ['identity'] });
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: revalidateOnAuthError }),
  mutationCache: new MutationCache({ onError: revalidateOnAuthError }),
  defaultOptions: {
    queries: { retry: false, staleTime: 15_000, gcTime: 5 * 60_000 },
    mutations: { retry: false },
  },
});
async function readIdentity(signal?: AbortSignal) {
  // The supported auth client processes renewal/revocation cookies in SecureStore.
  const session = await authClient.getSession({ fetchOptions: { signal } });
  if (session.error?.status === 401) return null;
  if (session.error)
    throw new ApiError(
      session.error.status,
      'SESSION_CHECK_FAILED',
      'Could not check your session. Please try again.',
    );
  if (!session.data) return null;
  try {
    return await api('/me', meSchema, undefined, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
type Challenge = { email: string; sentAt: number };
type SessionContext = {
  me: Me | null;
  loading: boolean;
  resolved: boolean;
  error: unknown;
  challenge: Challenge | null;
  setChallenge: (value: Challenge | null) => void;
  refresh: () => Promise<void>;
  signedIn: () => Promise<void>;
  changeAccount: (
    expectedUserId: string,
    work: () => Promise<void>,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  forgetSession: (expectedUserId?: string) => Promise<boolean>;
};
const Context = createContext<SessionContext | null>(null);
function Session({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const revision = useRef(0);
  const switchingAccount = useRef(false),
    signingOut = useRef(0);
  const [pendingCleanups, setPendingCleanups] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: ({ signal }) => readIdentity(signal),
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  });
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) =>
      focusManager.setFocused(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (identity.data === null)
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'identity',
      });
  }, [identity.data, client]);
  async function refresh() {
    await client.invalidateQueries();
  }
  async function signedIn() {
    revision.current++;
    setChallenge(null);
    await client.cancelQueries();
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'identity',
    });
    client.getMutationCache().clear();
    await client.invalidateQueries({
      queryKey: ['identity'],
      exact: true,
      refetchType: 'none',
    });
    await client.fetchQuery({
      queryKey: ['identity'],
      queryFn: ({ signal }) => readIdentity(signal),
    });
  }
  async function changeAccount(
    expectedUserId: string,
    work: () => Promise<void>,
  ) {
    if (
      switchingAccount.current ||
      signingOut.current ||
      currentUserId() !== expectedUserId
    )
      throw new Error('Your account changed. Reopen this screen.');
    switchingAccount.current = true;
    const started = ++revision.current;
    setPendingCleanups((count) => count + 1);
    try {
      // Hide every authenticated action before a cookie-changing request can start.
      await client.cancelQueries();
      if (revision.current !== started || currentUserId() !== expectedUserId)
        throw new Error('Your account changed. Reopen this screen.');
      await work();
      if (revision.current !== started)
        throw new Error('Your account changed. Reopen this screen.');
      await signedIn();
    } finally {
      switchingAccount.current = false;
      setPendingCleanups((count) => count - 1);
    }
  }
  async function signOut() {
    if (switchingAccount.current)
      throw new Error('Please wait for the account switch to finish.');
    signingOut.current++;
    const started = ++revision.current;
    const userId = identity.data?.user.id;
    setPendingCleanups((count) => count + 1);
    try {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error(
          'Could not sign out. Check your connection and try again.',
        );
      await clearLocalSession(
        () => revision.current === started && currentUserId() === userId,
      );
    } finally {
      signingOut.current--;
      setPendingCleanups((count) => count - 1);
    }
  }
  function currentUserId() {
    return client.getQueryData<Me | null>(['identity'])?.user.id;
  }
  async function forgetSession(expectedUserId = identity.data?.user.id) {
    // The server has already revoked this session (deletion/email change/revoke).
    // Expo's supported sign-out action clears its cookie cache before networking.
    if (!expectedUserId || currentUserId() !== expectedUserId) return false;
    const started = ++revision.current;
    setPendingCleanups((count) => count + 1);
    try {
      const cleared = await clearLocalSession(
        () =>
          revision.current === started && currentUserId() === expectedUserId,
      );
      // A programmatic identity change may occur while native cleanup settles.
      if (!cleared || revision.current !== started || currentUserId())
        return false;
      await authClient
        .signOut({ fetchOptions: { timeout: 3000 } })
        .catch(() => {});
      return revision.current === started && !currentUserId();
    } finally {
      setPendingCleanups((count) => count - 1);
    }
  }
  async function clearLocalSession(current: () => boolean) {
    await client.cancelQueries();
    if (!current()) return false;
    setChallenge(null);
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'identity',
    });
    client.getMutationCache().clear();
    client.setQueryData(['identity'], null);
    await clearPushState().catch(() => {});
    return true;
  }
  return (
    <Context.Provider
      value={{
        me: identity.data ?? null,
        loading: identity.isPending || pendingCleanups > 0,
        resolved: identity.data !== undefined,
        error: identity.error,
        challenge,
        setChallenge,
        refresh,
        signedIn,
        changeAccount,
        signOut,
        forgetSession,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Session>{children}</Session>
    </QueryClientProvider>
  );
}
export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error('SessionProvider is required');
  return session;
}
