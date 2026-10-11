import { clearPushState } from '../features/notifications/native';
import {
  createContext,
  useContext,
  useEffect,
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
  error: unknown;
  challenge: Challenge | null;
  setChallenge: (value: Challenge | null) => void;
  refresh: () => Promise<void>;
  signedIn: () => Promise<void>;
  signOut: () => Promise<void>;
};
const Context = createContext<SessionContext | null>(null);
function Session({ children }: { children: ReactNode }) {
  const client = useQueryClient();
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
  async function signOut() {
    const result = await authClient.signOut();
    if (result.error)
      throw new Error(
        'Could not sign out. Check your connection and try again.',
      );
    setChallenge(null);
    await client.cancelQueries();
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'identity',
    });
    client.getMutationCache().clear();
    client.setQueryData(['identity'], null);
    await clearPushState().catch(() => {});
  }
  return (
    <Context.Provider
      value={{
        me: identity.data ?? null,
        loading: identity.isPending,
        error: identity.error,
        challenge,
        setChallenge,
        refresh,
        signedIn,
        signOut,
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
