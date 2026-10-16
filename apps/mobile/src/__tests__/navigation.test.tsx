import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationProvider } from '../components/navigation/provider';
import { useCommunityNavigation } from '../components/navigation/context';
import { BottomNavigation } from '../components/navigation/bar';
import type { Me } from '@portl/contracts';
const mockReplace = jest.fn();
let mockPath = '/community';
let mockParams: Record<string, string> = {};
const member: Me['memberships'][number] = {
  society: { id: 'a', name: 'Gardens', isDemo: true },
  roles: ['RESIDENT', 'GUARD'],
  flats: [],
};
const me: Me = {
  user: {
    id: 'user',
    email: 'resident@example.com',
    name: 'Resident',
    emailVerified: true,
  },
  memberships: [member],
  policyRequired: false,
  onboardingRequired: false,
  adminAssuredUntil: null,
  adminAuthenticatorConfigured: false,
};
let mockSession = {
  me: me as Me | null,
  loading: false,
  error: null as Error | null,
};
jest.mock('../auth/session', () => ({ useSession: () => mockSession }));
jest.mock('expo-router', () => ({
  usePathname: () => mockPath,
  useGlobalSearchParams: () => mockParams,
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('../components/icon', () => ({ Icon: () => null }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
function CurrentContext() {
  const nav = useCommunityNavigation();
  return <Text>{nav?.context?.member.society.name ?? 'Choose community'}</Text>;
}
const App = () => (
  <NavigationProvider>
    <CurrentContext />
    <BottomNavigation />
  </NavigationProvider>
);
beforeEach(() => {
  mockPath = '/community';
  mockParams = { societyId: 'a', view: 'GUARD' };
  mockSession = { me: { ...me }, loading: false, error: null };
  jest.clearAllMocks();
});
it('routes guard history with the selected society and guard view', () => {
  render(<App />);
  fireEvent.press(screen.getByRole('tab', { name: 'History' }));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/visitors',
    params: { societyId: 'a', view: 'GUARD', filter: 'HISTORY' },
  });
  expect(screen.queryByRole('tab', { name: 'Notices' })).toBeNull();
});
it('withholds navigation for policy-required and disposable lifecycle accounts', () => {
  mockSession.me = { ...mockSession.me!, policyRequired: true };
  const view = render(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
  mockSession.me = {
    ...mockSession.me!,
    policyRequired: false,
    reviewLifecycle: {
      purpose: 'deletion',
      nextEmail: 'review@example.com',
      expiresAt: '2026-10-23T00:00:00.000Z',
    },
  };
  view.rerender(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
});
it('removes the previous context immediately after an account or membership change', () => {
  const view = render(<App />);
  expect(screen.getByText('Gardens')).toBeTruthy();
  mockSession.me = {
    ...mockSession.me!,
    user: { ...mockSession.me!.user, id: 'different' },
    memberships: [],
  };
  mockParams = {};
  view.rerender(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByText('Choose community')).toBeTruthy();
});
it('hides navigation while identity is unresolved or temporarily blocked', () => {
  const view = render(<App />);
  mockSession.loading = true;
  view.rerender(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
  mockSession.loading = false;
  mockSession.error = new Error('Offline identity check');
  view.rerender(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
});
it('keeps onboarding and public routes free of the member tab bar', () => {
  mockPath = '/invitation';
  const view = render(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
  mockPath = '/login';
  view.rerender(<App />);
  expect(screen.queryByRole('tab')).toBeNull();
});

it('forgets a role choice after sign-out, even when the same account signs in again', () => {
  const view = render(<App />);
  mockParams = {};
  mockSession.me = null;
  view.rerender(<App />);
  mockSession.me = me;
  view.rerender(<App />);
  expect(screen.getByText('Choose community')).toBeTruthy();
  expect(screen.queryByRole('tab')).toBeNull();
});
