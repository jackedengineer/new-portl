import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Login from '../app/(public)/login';
import Verify from '../app/(public)/verify';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetChallenge = jest.fn();
const mockSignedIn = jest.fn();
const mockSend = jest.fn();
const mockVerify = jest.fn();
let mockChallenge: { email: string; sentAt: number } | null = null;
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => false,
  },
  Redirect: () => null,
}));
jest.mock('../auth/session', () => ({
  useSession: () => ({
    challenge: mockChallenge,
    setChallenge: mockSetChallenge,
    signedIn: mockSignedIn,
  }),
}));
jest.mock('../lib/auth-client', () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => mockSend(...args),
    },
    signIn: { emailOtp: (...args: unknown[]) => mockVerify(...args) },
  },
}));
jest.mock('../lib/api', () => ({ messageOf: (error: Error) => error.message }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  mockChallenge = null;
  mockSend.mockResolvedValue({ data: { success: true } });
  mockVerify.mockResolvedValue({ data: { user: { id: 'test' } } });
  mockSignedIn.mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());
it('validates email before sending and passes no personal data in navigation', async () => {
  render(<Login />);
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  expect(mockSend).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    ' A@Example.COM ',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith({
      email: 'a@example.com',
      type: 'sign-in',
    }),
  );
  expect(mockSetChallenge).toHaveBeenCalledWith({
    email: 'a@example.com',
    sentAt: expect.any(Number),
  });
  expect(mockPush).toHaveBeenCalledWith('/verify');
});
it('keeps the user on login when email delivery fails', async () => {
  mockSend.mockResolvedValue({ error: { status: 503 } });
  render(<Login />);
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.changeText(screen.getByLabelText('Email address'), 'a@example.com');
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  await waitFor(() =>
    expect(
      screen.getByText('We couldn’t send a code. Please try again.'),
    ).toBeTruthy(),
  );
  expect(mockPush).not.toHaveBeenCalled();
});
it('verifies a complete OTP and revalidates server identity before navigation', async () => {
  mockChallenge = { email: 'a@example.com', sentAt: Date.now() };
  render(<Verify />);
  fireEvent.changeText(
    screen.getByLabelText('Six-digit email code'),
    '12a3456',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Verify & continue' }));
  await waitFor(() => expect(mockSignedIn).toHaveBeenCalled());
  expect(mockVerify).toHaveBeenCalledWith({
    email: 'a@example.com',
    otp: '123456',
    policyAcceptance: {
      adult: true,
      termsVersion: '2026-10-14',
      privacyVersion: '2026-10-14',
    },
  });
  expect(mockReplace).not.toHaveBeenCalled();
});
it('keeps rejected OTPs out of the authenticated routes', async () => {
  mockChallenge = { email: 'a@example.com', sentAt: Date.now() };
  mockVerify.mockResolvedValue({ error: { status: 400 } });
  render(<Verify />);
  fireEvent.changeText(screen.getByLabelText('Six-digit email code'), '123456');
  fireEvent.press(screen.getByRole('button', { name: 'Verify & continue' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        'This code is invalid or has expired. Check it or request a new code.',
      ),
    ).toBeTruthy(),
  );
  expect(mockSignedIn).not.toHaveBeenCalled();
});
it('enforces resend cooldown and expires the code after five minutes', () => {
  jest.useFakeTimers();
  mockChallenge = { email: 'a@example.com', sentAt: Date.now() };
  render(<Verify />);
  expect(
    screen.getByRole('button', { name: 'Resend code in 60s' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  act(() => jest.advanceTimersByTime(60_000));
  expect(
    screen.getByRole('button', { name: 'Resend code' }).props.accessibilityState
      .disabled,
  ).toBe(false);
  act(() => jest.advanceTimersByTime(240_000));
  expect(
    screen.getByText('This code has expired. Request a new one to continue.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Verify & continue' }).props
      .accessibilityState.disabled,
  ).toBe(true);
});

it('keeps age and policy acceptance unchecked and blocks sending until explicitly accepted', async () => {
  render(<Login />);
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'adult@example.invalid',
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  expect(mockSend).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox').props.accessibilityState.checked).toBe(
    false,
  );
  expect(
    screen.getByText(
      'Confirm your age and accept the terms and privacy notice.',
    ),
  ).toBeTruthy();
});
