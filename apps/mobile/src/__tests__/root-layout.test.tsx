import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import RootLayout from '../app/_layout';

const mockRefresh = jest.fn(),
  mockSave = jest.fn(),
  mockUnmount = jest.fn(),
  mockStartLogin = jest.fn();
let mockNextIntent = 0;
let mockSession = {
  me: { user: { id: 'alice' }, policyRequired: false } as {
    user: { id: string };
    policyRequired: boolean;
  } | null,
  resolved: true,
  loading: false,
  error: null as Error | null,
  refresh: mockRefresh,
};
function MockDraft() {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [intent] = useState(() => ++mockNextIntent);
  useEffect(() => () => mockUnmount(), []);
  return (
    <View>
      <TextInput
        accessibilityLabel="Unsent draft"
        value={text}
        onChangeText={setText}
      />
      <Text>Intent {intent}</Text>
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Submit draft"
        onPress={() => {
          void mockSave().catch((e: Error) => setError(e.message));
        }}
      >
        <Text>Submit draft</Text>
      </Pressable>
    </View>
  );
}
function MockPublicAuth() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Public sign-in"
      onPress={mockStartLogin}
    >
      <Text>Public sign-in</Text>
    </Pressable>
  );
}
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    Stack: Object.assign(
      ({ children }: { children: ReactNode }) =>
        React.createElement(React.Fragment, null, children),
      {
        Protected: ({
          guard,
          children,
        }: {
          guard: boolean;
          children: ReactNode;
        }) => (guard ? children : null),
        Screen: ({ name }: { name: string }) =>
          name === '(member)'
            ? React.createElement(MockDraft)
            : name === '(public)'
              ? React.createElement(MockPublicAuth)
              : null,
      },
    ),
  };
});
jest.mock('../auth/session', () => ({
  useSession: () => mockSession,
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../features/notifications/bridge', () => ({
  NotificationBridge: () => null,
}));
jest.mock('../components/navigation/provider', () => ({
  NavigationProvider: ({ children }: { children: ReactNode }) => children,
  useCommunityNavigation: () => null,
}));
jest.mock('../components/navigation/bar', () => ({
  BottomNavigation: () => null,
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockNextIntent = 0;
  mockSession = {
    me: { user: { id: 'alice' }, policyRequired: false },
    resolved: true,
    loading: false,
    error: null,
    refresh: mockRefresh,
  };
});
it('retains draft text and the original retry intent while a transient session error blocks interaction', () => {
  const view = render(<RootLayout />);
  fireEvent.changeText(
    screen.getByLabelText('Unsent draft'),
    'Preserve this notice',
  );
  const intent = screen.getByText('Intent 1');
  mockSession = { ...mockSession, error: new Error('Connection lost') };
  view.rerender(<RootLayout />);
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Submit draft' })).toBeNull();
  fireEvent.press(
    screen.getByLabelText('Submit draft', { includeHiddenElements: true }),
  );
  expect(mockSave).not.toHaveBeenCalled();
  expect(screen.getByText('Intent 1', { includeHiddenElements: true })).toBe(
    intent,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  mockSession = { ...mockSession, error: null };
  view.rerender(<RootLayout />);
  expect(screen.getByLabelText('Unsent draft').props.value).toBe(
    'Preserve this notice',
  );
  expect(screen.getByText('Intent 1')).toBe(intent);
  fireEvent.press(screen.getByRole('button', { name: 'Submit draft' }));
  expect(mockSave).toHaveBeenCalledTimes(1);
});
it('removes authenticated forms after an authoritative signed-out identity', () => {
  const view = render(<RootLayout />);
  fireEvent.changeText(screen.getByLabelText('Unsent draft'), 'Private draft');
  mockSession = { ...mockSession, me: null };
  view.rerender(<RootLayout />);
  expect(
    screen.queryByLabelText('Unsent draft', { includeHiddenElements: true }),
  ).toBeNull();
  expect(mockUnmount).toHaveBeenCalledTimes(1);
});
it('offers retry without mounting private routes when the initial identity check fails', () => {
  mockSession = {
    ...mockSession,
    me: null,
    resolved: false,
    error: new Error('Connection lost'),
  };
  render(<RootLayout />);
  expect(
    screen.queryByLabelText('Unsent draft', { includeHiddenElements: true }),
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it('starts fresh forms when the resolved account changes', () => {
  const view = render(<RootLayout />);
  fireEvent.changeText(
    screen.getByLabelText('Unsent draft'),
    'Alice private draft',
  );
  mockSession = {
    ...mockSession,
    me: { user: { id: 'bob' }, policyRequired: false },
  };
  view.rerender(<RootLayout />);
  expect(screen.getByLabelText('Unsent draft').props.value).toBe('');
  expect(screen.getByText('Intent 2')).toBeTruthy();
  expect(mockUnmount).toHaveBeenCalledTimes(1);
});

it('hides and blocks sign-in routes until session cleanup has finished', () => {
  mockSession = { ...mockSession, me: null, loading: true };
  const view = render(<RootLayout />);
  expect(screen.queryByRole('button', { name: 'Public sign-in' })).toBeNull();
  fireEvent.press(
    screen.getByLabelText('Public sign-in', { includeHiddenElements: true }),
  );
  expect(mockStartLogin).not.toHaveBeenCalled();
  mockSession = { ...mockSession, loading: false };
  view.rerender(<RootLayout />);
  fireEvent.press(screen.getByRole('button', { name: 'Public sign-in' }));
  expect(mockStartLogin).toHaveBeenCalledTimes(1);
});

it('preserves a draft and its error observer through failed session cleanup', async () => {
  const view = render(<RootLayout />);
  fireEvent.changeText(screen.getByLabelText('Unsent draft'), 'Keep my draft');
  let fail!: (error: Error) => void;
  mockSave.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Submit draft' }));
  mockSession = { ...mockSession, loading: true };
  view.rerender(<RootLayout />);
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Submit draft' })).toBeNull();
  await act(async () => fail(new Error('Could not sign out')));
  mockSession = { ...mockSession, loading: false };
  view.rerender(<RootLayout />);
  expect(screen.getByLabelText('Unsent draft').props.value).toBe(
    'Keep my draft',
  );
  expect(screen.getByText('Could not sign out')).toBeTruthy();
  expect(screen.getByText('Intent 1')).toBeTruthy();
});
it('does not mount auth navigation before the initial identity has resolved', () => {
  mockSession = { ...mockSession, me: null, loading: true, resolved: false };
  render(<RootLayout />);
  expect(
    screen.queryByLabelText('Public sign-in', { includeHiddenElements: true }),
  ).toBeNull();
});
