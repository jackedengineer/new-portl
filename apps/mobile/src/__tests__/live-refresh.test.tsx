import { act, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { useLiveGate } from '../features/gate/live';
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
const rendered = jest.fn();
function Probe({ clock = false }: { clock?: boolean }) {
  const live = useLiveGate(clock);
  rendered(live.clock);
  return <Text>{live.clock}</Text>;
}
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  rendered.mockClear();
});
afterEach(() => jest.useRealTimers());
it('does not re-render read-only list screens every second', () => {
  render(<Probe />);
  const count = rendered.mock.calls.length;
  act(() => jest.advanceTimersByTime(5000));
  expect(rendered).toHaveBeenCalledTimes(count);
});
it('keeps the live clock on sensitive actions so cached approvals still expire', () => {
  const start = Date.now();
  render(<Probe clock />);
  act(() => jest.advanceTimersByTime(5000));
  expect(screen.getByText(String(start + 5000))).toBeTruthy();
});
