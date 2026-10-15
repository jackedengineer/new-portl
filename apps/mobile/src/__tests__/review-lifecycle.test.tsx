import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  StartReviewLifecycle,
  ReviewCode,
} from '../features/account/review-lifecycle';
const mockFetch = jest.fn(),
  mockSignedIn = jest.fn(),
  mockReplace = jest.fn(),
  mockApi = jest.fn();
jest.mock('../auth/session', () => ({
  useSession: () => ({
    changeAccount: async (_user: string, work: () => Promise<void>) => {
      await work();
      await mockSignedIn();
    },
  }),
}));
jest.mock('../lib/auth-client', () => ({
  authClient: { $fetch: (...args: unknown[]) => mockFetch(...args) },
}));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  messageOf: (e: Error) => e.message,
}));
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
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ data: { success: true } });
  mockSignedIn.mockResolvedValue(undefined);
  mockApi.mockResolvedValue({ otp: '123456' });
});
it('switches into a server allocated fixture only after explicit choice and refreshed identity', async () => {
  render(<StartReviewLifecycle userId="shared-reviewer" />);
  fireEvent.press(
    screen.getByRole('button', {
      name: 'Start disposable email-change account',
    }),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/account'));
  expect(mockFetch).toHaveBeenCalledWith('/reviewer/lifecycle', {
    method: 'POST',
    headers: { 'x-portl-expected-user': 'shared-reviewer' },
    body: { purpose: 'email-change' },
  });
  expect(mockSignedIn).toHaveBeenCalled();
});
it('reveals only an authenticated account-bound synthetic code on request', async () => {
  render(<ReviewCode userId="child" purpose="delete-account" />);
  expect(screen.queryByText('123456')).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Show synthetic verification code' }),
  );
  await screen.findByText('123456');
  expect(mockApi).toHaveBeenCalledWith(
    '/account/review-code',
    expect.anything(),
    { purpose: 'delete-account' },
    undefined,
    'child',
  );
});
it('does not navigate when fixture allocation is rejected', async () => {
  mockFetch.mockResolvedValue({ error: { status: 429 } });
  render(<StartReviewLifecycle userId="shared" />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Start disposable deletion account' }),
  );
  await screen.findByText(
    'Disposable access is unavailable. Sign in to Reviewer access again, or wait for fixture cleanup and retry.',
  );
  expect(mockSignedIn).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('does not navigate after its initiating screen unmounts during an account switch', async () => {
  let finish!: (value: unknown) => void;
  mockFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<StartReviewLifecycle userId="shared" />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Start disposable deletion account' }),
  );
  view.unmount();
  await act(async () => finish({ data: { success: true } }));
  expect(mockReplace).not.toHaveBeenCalled();
});
