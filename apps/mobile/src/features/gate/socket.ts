import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { gateSignalSchema, type GateView } from '@portl/contracts';
import { apiURL, authClient } from '../../lib/auth-client';
import { gateKey } from './live';

/** A fresh cookie and authorization check on every connection; REST owns all data. */
export function useGateSocket(
  userId: string,
  societyId: string,
  view: GateView,
  enabled: boolean,
) {
  const client = useQueryClient();
  const scope = JSON.stringify([userId, societyId, view]);
  const [connectedScope, setConnectedScope] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: Socket | undefined;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const queryKey = gateKey(userId, societyId);
    function refreshSoon() {
      if (disposed || refresh) return;
      refresh = setTimeout(() => {
        refresh = undefined;
        if (!disposed) void client.invalidateQueries({ queryKey });
      }, 100);
    }
    function reconnect() {
      if (disposed || retry) return;
      setConnectedScope(null);
      socket?.removeAllListeners();
      socket?.disconnect();
      // Explicit retry lets asynchronous SecureStore reads finish before the handshake.
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
      retry = setTimeout(
        () => {
          retry = undefined;
          void connect();
        },
        delay + Math.floor(Math.random() * 500),
      );
    }
    async function connect() {
      try {
        const cookie =
          Platform.OS === 'web' ? '' : await authClient.getCookie();
        if (disposed) return;
        const next = io(apiURL, {
          autoConnect: false,
          reconnection: false,
          forceNew: true,
          timeout: 10_000,
          withCredentials: true,
          auth: { userId, societyId, view },
          ...(Platform.OS === 'web'
            ? {}
            : {
                extraHeaders: {
                  'expo-origin': 'portl://',
                  cookie: cookie || '',
                },
              }),
        });
        socket = next;
        next.on('connect', () => {
          if (disposed || socket !== next) return;
          attempt = 0;
          setConnectedScope(scope);
          refreshSoon();
        });
        next.on('gate:changed', (value: unknown) => {
          if (disposed || socket !== next) return;
          const parsed = gateSignalSchema.safeParse(value);
          if (parsed.success && parsed.data.societyId === societyId)
            refreshSoon();
        });
        next.on('disconnect', (reason) => {
          if (disposed || socket !== next) return;
          if (reason === 'io server disconnect')
            void client.resetQueries({ queryKey });
          reconnect();
        });
        next.on('connect_error', (error) => {
          if (disposed || socket !== next) return;
          if ('data' in error && error.data?.code === 'ACCESS_DENIED')
            void client.resetQueries({ queryKey });
          reconnect();
        });
        next.connect();
      } catch {
        reconnect();
      }
    }
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(refresh);
      socket?.removeAllListeners();
      socket?.disconnect();
      setConnectedScope(null);
    };
  }, [client, enabled, scope, societyId, userId, view]);
  return enabled && connectedScope === scope;
}
