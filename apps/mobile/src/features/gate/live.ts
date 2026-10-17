import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useNetworkState } from 'expo-network';
export function useLiveGate(trackTime = false) {
  const focused = useIsFocused();
  const network = useNetworkState();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setActive(s === 'active');
      setClock(Date.now());
    });
    return () => sub.remove();
  }, []);
  const online =
    network.isConnected !== false && network.isInternetReachable !== false;
  const enabled = focused && active && online;
  useEffect(() => {
    if (!enabled || !trackTime) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, trackTime]);
  return { enabled, online, clock };
}
export const gatePath = (sid: string, suffix: string) =>
  `/societies/${encodeURIComponent(sid)}/gate/${suffix}`;
export const gateKey = (uid: string, sid: string) =>
  ['gate', uid, sid] as const;
