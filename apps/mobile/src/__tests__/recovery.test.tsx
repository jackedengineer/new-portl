import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { AdminRecovery } from '../features/account/recovery';
const mockApi = jest.fn(),
  mockForget = jest.fn(),
  mockRefetch = jest.fn();
let mockQuery: Record<string, unknown>;
jest.mock('@tanstack/react-query', () => ({ useQuery: () => mockQuery }));
jest.mock('../lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  successSchema: {},
  messageOf: (error: Error) => error.message,
}));
jest.mock('../auth/session', () => ({
  useSession: () => ({ forgetSession: mockForget }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const id = '11111111-1111-4111-8111-111111111111',
  setupKey = 'PRIVATESETUPKEYTESTONLY',
  enrollment = {
    id,
    setupKey,
    totpURI: `otpauth://totp/Portl:fixture?secret=${setupKey}`,
  };
let onState: (state: string) => void;
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.mockReset();
  mockForget.mockResolvedValue(undefined);
  mockRefetch.mockResolvedValue(undefined);
  mockQuery = {
    data: {
      request: {
        id,
        operation: 'RESTORE_ADMIN',
        societyName: 'Fictional Society',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
      completedAt: null,
    },
    isPending: false,
    error: null,
    refetch: mockRefetch,
  };
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      onState = listener as (state: string) => void;
      return { remove: jest.fn() };
    });
});
afterEach(() => jest.restoreAllMocks());
it('does not fetch credentials until explicit enrollment and requires both proofs plus RECOVER', async () => {
  render(<AdminRecovery userId="user-a" />);
  expect(mockApi).not.toHaveBeenCalled();
  expect(screen.queryByText(setupKey)).toBeNull();
  mockApi.mockResolvedValueOnce(enrollment);
  fireEvent.press(
    screen.getByRole('button', { name: 'Set up recovery authenticator' }),
  );
  await screen.findByText(setupKey);
  const button = screen.getByRole('button', {
    name: 'Complete admin recovery',
  });
  expect(button.props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Recovery email code'), '123456');
  fireEvent.changeText(
    screen.getByLabelText('New authenticator code'),
    '234567',
  );
  expect(button.props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(
    screen.getByLabelText('Type RECOVER to confirm'),
    'RECOVER',
  );
  mockApi.mockResolvedValueOnce({ success: true });
  fireEvent.press(button);
  await waitFor(() => expect(mockForget).toHaveBeenCalledWith('user-a'));
  expect(mockApi).toHaveBeenLastCalledWith(
    '/account/recovery/confirm',
    expect.anything(),
    { id, otp: '123456', totpCode: '234567', confirmation: 'RECOVER' },
    undefined,
    'user-a',
  );
  expect(screen.queryByText(setupKey)).toBeNull();
});
it('does not re-expose a delayed enrollment response after backgrounding', async () => {
  let finish!: (value: typeof enrollment) => void;
  mockApi.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AdminRecovery userId="user-a" />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Set up recovery authenticator' }),
  );
  act(() => onState('background'));
  await act(async () => finish(enrollment));
  expect(screen.queryByText(setupKey)).toBeNull();
});
it('clears a revealed key and proof inputs when backgrounded', async () => {
  mockApi.mockResolvedValueOnce(enrollment);
  render(<AdminRecovery userId="user-a" />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Set up recovery authenticator' }),
  );
  await screen.findByText(setupKey);
  fireEvent.changeText(screen.getByLabelText('Recovery email code'), '123456');
  act(() => onState('background'));
  expect(screen.queryByText(setupKey)).toBeNull();
  expect(screen.queryByLabelText('Recovery email code')).toBeNull();
});
it('does not claim completion or clear identity after an uncertain confirmation response', async () => {
  mockApi.mockResolvedValueOnce(enrollment);
  render(<AdminRecovery userId="user-a" />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Set up recovery authenticator' }),
  );
  await screen.findByText(setupKey);
  fireEvent.changeText(screen.getByLabelText('Recovery email code'), '123456');
  fireEvent.changeText(
    screen.getByLabelText('New authenticator code'),
    '234567',
  );
  fireEvent.changeText(
    screen.getByLabelText('Type RECOVER to confirm'),
    'RECOVER',
  );
  mockApi.mockRejectedValueOnce(new Error('Network unavailable'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Complete admin recovery' }),
  );
  await screen.findByText(/If confirmation may have succeeded/);
  expect(mockForget).not.toHaveBeenCalled();
});
it('shows a usable empty state without exposing enrollment when no request exists', () => {
  mockQuery = { ...mockQuery, data: { request: null, completedAt: null } };
  render(<AdminRecovery userId="user-a" />);
  expect(screen.getByText(/No pending recovery request/)).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Set up recovery authenticator' }),
  ).toBeNull();
});
it('does not clear a new identity when confirmation returns after account-switch unmount', async () => {
  mockApi.mockResolvedValueOnce(enrollment);
  const view = render(<AdminRecovery userId="user-a" />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Set up recovery authenticator' }),
  );
  await screen.findByText(setupKey);
  fireEvent.changeText(screen.getByLabelText('Recovery email code'), '123456');
  fireEvent.changeText(
    screen.getByLabelText('New authenticator code'),
    '234567',
  );
  fireEvent.changeText(
    screen.getByLabelText('Type RECOVER to confirm'),
    'RECOVER',
  );
  let finish!: (value: { success: boolean }) => void;
  mockApi.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Complete admin recovery' }),
  );
  view.unmount();
  await act(async () => finish({ success: true }));
  expect(mockForget).not.toHaveBeenCalled();
});
