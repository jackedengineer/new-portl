import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { notificationSchema } from '@portl/contracts';
import { useSession } from '../../auth/session';
import { api } from '../../lib/api';
import { nativeNotifications, refreshPush, setPushIdentity } from './native';
import { notificationDestination } from './navigation';
export function NotificationBridge() {
  const { me, loading, error } = useSession(),
    client = useQueryClient();
  const identityReady = !loading && !error;
  const userId = identityReady ? (me?.user.id ?? null) : null;
  const current = useRef(userId);
  useLayoutEffect(() => {
    current.current = userId;
    setPushIdentity(userId);
  }, [userId]);
  useEffect(() => {
    if (!identityReady) return;
    setPushIdentity(userId);
    let active = true,
      cleanup = () => {};
    const controller = new AbortController();
    void nativeNotifications()
      .then((module) => {
        if (!module || !active) return;
        if (!userId) {
          void module.clearLastNotificationResponseAsync().catch(() => {});
          return;
        }
        const live = () => active && current.current === userId;
        const invalidate = () => {
          if (!live()) return;
          void client.invalidateQueries({
            queryKey: ['notifications', userId],
          });
          void client.invalidateQueries({ queryKey: ['gate', userId] });
        };
        const handled = new Set<string>();
        const respond = async (
          response: import('expo-notifications').NotificationResponse,
        ) => {
          if (!live() || handled.has(response.notification.request.identifier))
            return;
          handled.add(response.notification.request.identifier);
          if (handled.size > 50) handled.delete(handled.values().next().value!);
          try {
            const destination = await notificationDestination(
              response.notification.request.content.data,
              (id) =>
                api(
                  `/notifications/${id}/read`,
                  notificationSchema,
                  {},
                  controller.signal,
                  userId,
                ),
            );
            if (!live()) return;
            invalidate();
            if (destination) router.push(destination);
          } catch {
            if (live()) router.push('/notifications');
          } finally {
            if (live())
              void module.clearLastNotificationResponseAsync().catch(() => {});
          }
        };
        const received = module.addNotificationReceivedListener(invalidate);
        const response = module.addNotificationResponseReceivedListener(
          (r) => void respond(r),
        );
        const rotated = module.addPushTokenListener(
          () => void refreshPush(userId).catch(() => {}),
        );
        const foreground = AppState.addEventListener('change', (state) => {
          if (state === 'active') {
            invalidate();
            void refreshPush(userId).catch(() => {});
          }
        });
        const previous = module.getLastNotificationResponse();
        if (previous) void respond(previous);
        void refreshPush(userId).catch(() => {});
        cleanup = () => {
          received.remove();
          response.remove();
          rotated.remove();
          foreground.remove();
        };
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
      cleanup();
    };
  }, [userId, identityReady, client]);
  return null;
}
