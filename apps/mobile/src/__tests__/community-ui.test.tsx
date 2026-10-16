import { fireEvent, render, screen } from '@testing-library/react-native';
import type { GateView, Me } from '@portl/contracts';
import { CommunityDashboard } from '../features/community/dashboard';
import { Disclosure, Segments } from '../components/task-ui';
import { Text } from 'react-native';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('../features/gate/visitor-queue', () => ({
  VisitorQueue: () => null,
}));
const member: Me['memberships'][number] = {
  society: { id: 'society', name: 'Gardens', isDemo: true },
  roles: ['RESIDENT', 'GUARD', 'ADMIN'],
  flats: [],
};
function show(role: GateView) {
  return render(
    <CommunityDashboard context={{ member, role }} userId="user" />,
  );
}
it('keeps resident guest creation and directory reachable with the current society', () => {
  show('RESIDENT');
  fireEvent.press(screen.getByRole('button', { name: 'Invite a guest' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/create-guest-pass',
    params: { societyId: 'society' },
  });
  fireEvent.press(screen.getByRole('button', { name: 'Community directory' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/directory',
    params: { societyId: 'society' },
  });
  expect(
    screen.queryByRole('button', { name: 'Manage resident onboarding' }),
  ).toBeNull();
});
it('keeps guard tasks separate from resident and admin links', () => {
  show('GUARD');
  fireEvent.press(screen.getByRole('button', { name: 'Open guard dashboard' }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/visitors',
    params: { societyId: 'society', view: 'GUARD' },
  });
  expect(
    screen.queryByRole('button', { name: 'Community directory' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Invite a guest' })).toBeNull();
});
it('retains admin onboarding, notices and society movement shortcuts', () => {
  show('ADMIN');
  fireEvent.press(
    screen.getByRole('button', { name: 'Manage resident onboarding' }),
  );
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/admin',
    params: { societyId: 'society' },
  });
  fireEvent.press(
    screen.getByRole('button', { name: 'View society visitors' }),
  );
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/visitors',
    params: { societyId: 'society', view: 'ADMIN' },
  });
});
it('keeps collapsed community access content reachable and reports its expanded state', () => {
  render(
    <Disclosure title="Community access">
      <Text>Application status</Text>
    </Disclosure>,
  );
  expect(screen.queryByText('Application status')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Community access' }));
  expect(screen.getByText('Application status')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Community access', expanded: true }),
  ).toBeTruthy();
});

it('keeps locked segmented choices disabled instead of changing form state', () => {
  const change = jest.fn();
  render(
    <Segments
      label="Pass duration"
      options={[
        [15, '15 min'],
        [60, '1 hr'],
      ]}
      value={15}
      disabled
      onChange={change}
    />,
  );
  fireEvent.press(screen.getByRole('tab', { name: '1 hr' }));
  expect(change).not.toHaveBeenCalled();
  expect(
    screen.getByRole('tab', { name: '15 min', selected: true, disabled: true }),
  ).toBeTruthy();
});
