import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { DeleteAccount } from '../features/account/deletion';
import { ChangeEmail } from '../features/account/email-change';
const mockApi = jest.fn(),
  mockSave = jest.fn(),
  mockForget = jest.fn(),
  mockReplace = jest.fn(),
  mockSend = jest.fn(),
  mockRequest = jest.fn(),
  mockChange = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockReplace(...a),
    push: jest.fn(),
    canGoBack: () => false,
  },
}));
jest.mock('../lib/api', () => ({
  api: (...a: unknown[]) => mockApi(...a),
  messageOf: (e: Error) => e.message,
}));
jest.mock('../auth/session', () => ({
  useSession: () => ({ forgetSession: mockForget }),
}));
jest.mock('../features/account/receipt', () => ({
  saveReceipt: (...a: unknown[]) => mockSave(...a),
}));
jest.mock('../lib/auth-client', () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...a: unknown[]) => mockSend(...a),
      requestEmailChange: (...a: unknown[]) => mockRequest(...a),
      changeEmail: (...a: unknown[]) => mockChange(...a),
    },
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const challenge = {
  challengeId: '11111111-1111-4111-8111-111111111111',
  receiptToken: 'a'.repeat(64),
  expiresIn: 300,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.mockReset();
  mockApi.mockResolvedValueOnce(challenge);
  mockSave.mockResolvedValue(undefined);
  mockForget.mockResolvedValue(undefined);
  mockSend.mockResolvedValue({ data: { success: true } });
  mockRequest.mockResolvedValue({ data: { success: true } });
  mockChange.mockResolvedValue({ data: { success: true } });
});
async function deletion() {
  render(<DeleteAccount userId="user-a" email="a@example.invalid" />);
  fireEvent.press(screen.getByRole('button', { name: 'Send deletion code' }));
  await screen.findByLabelText('Deletion email code');
}
it('requires a separate code and explicit DELETE, persists receipt before a scoped request and clears identity after confirmation', async () => {
  await deletion();
  const button = screen.getByRole('button', {
    name: 'Permanently delete my account',
  });
  expect(button.props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Deletion email code'), '123456');
  fireEvent.changeText(
    screen.getByLabelText('Type DELETE to confirm'),
    'DELETE',
  );
  mockApi.mockImplementationOnce(
    async (path: string, _schema: unknown, body: unknown) => {
      expect(mockSave).toHaveBeenCalledWith(challenge.receiptToken);
      expect(path).toBe('/account/deletion/confirm');
      expect(body).toEqual({
        challengeId: challenge.challengeId,
        receiptToken: challenge.receiptToken,
        otp: '123456',
        confirmation: 'DELETE',
        expectedUserId: 'user-a',
      });
      return { status: 'PENDING' };
    },
  );
  fireEvent.press(button);
  await waitFor(() => expect(mockForget).toHaveBeenCalledTimes(1));
  expect(mockReplace).toHaveBeenCalledWith('/deletion-status');
});
it('does not send irreversible confirmation when secure receipt storage fails', async () => {
  await deletion();
  mockSave.mockRejectedValueOnce(new Error('Storage unavailable'));
  fireEvent.changeText(screen.getByLabelText('Deletion email code'), '123456');
  fireEvent.changeText(
    screen.getByLabelText('Type DELETE to confirm'),
    'DELETE',
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Permanently delete my account' }),
  );
  await screen.findByText(/Storage unavailable/);
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(mockForget).not.toHaveBeenCalled();
});
it('keeps the receipt and offers recovery when confirmation response is lost', async () => {
  await deletion();
  mockApi.mockRejectedValueOnce(new Error('Connection lost'));
  fireEvent.changeText(screen.getByLabelText('Deletion email code'), '123456');
  fireEvent.changeText(
    screen.getByLabelText('Type DELETE to confirm'),
    'DELETE',
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Permanently delete my account' }),
  );
  await screen.findByText(/check deletion status using your receipt/);
  expect(mockSave).toHaveBeenCalled();
  expect(mockForget).not.toHaveBeenCalled();
});
it('verifies both email addresses with identity binding and clears the session on success', async () => {
  render(<ChangeEmail userId="user-a" email="a@example.invalid" />);
  fireEvent.press(screen.getByRole('button', { name: 'Verify current email' }));
  await screen.findByLabelText('Current email code');
  fireEvent.changeText(
    screen.getByLabelText('New email address'),
    'b@example.invalid',
  );
  fireEvent.changeText(screen.getByLabelText('Current email code'), '123456');
  fireEvent.press(
    screen.getByRole('button', { name: 'Verify & send new email code' }),
  );
  await screen.findByLabelText('New email code');
  expect(mockRequest).toHaveBeenCalledWith({
    newEmail: 'b@example.invalid',
    otp: '123456',
    fetchOptions: { headers: { 'x-portl-expected-user': 'user-a' } },
  });
  expect(mockForget).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('New email code'), '654321');
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm email change & sign out' }),
  );
  await waitFor(() => expect(mockForget).toHaveBeenCalledTimes(1));
});
