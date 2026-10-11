import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { api, successSchema } from '../../lib/api';
let identity: string | null = null,
  epoch = 0;
const requests = new Set<AbortController>();
const optedOut = new Set<string>();
let mutations: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = mutations.then(work, work);
  mutations = result.catch(() => {});
  return result;
}
function cancelEnrollment() {
  epoch++;
  for (const request of requests) request.abort();
  requests.clear();
}
const preference = 'portl.push.opt-in-user',
  installation = 'portl.push.installation';
export function setPushIdentity(userId: string | null) {
  if (identity === userId) return;
  identity = userId;
  cancelEnrollment();
}
export function pushAvailable() {
  return (
    Platform.OS !== 'web' &&
    (Constants.executionEnvironment === ExecutionEnvironment.Standalone ||
      Constants.executionEnvironment === ExecutionEnvironment.Bare)
  );
}
export async function nativeNotifications(): Promise<
  typeof import('expo-notifications') | null
> {
  if (!pushAvailable()) return null;
  const module = await import('expo-notifications');
  module.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    }),
  });
  return module;
}
let installationPending: Promise<string> | null = null;
async function installationId() {
  if (!installationPending)
    installationPending = (async () => {
      const existing = await SecureStore.getItemAsync(installation);
      if (existing) return existing;
      const id = Crypto.randomUUID();
      await SecureStore.setItemAsync(installation, id);
      return id;
    })().catch((error) => {
      installationPending = null;
      throw error;
    });
  return installationPending;
}
export async function isPushEnabled(userId: string) {
  if (!pushAvailable()) return false;
  return (
    !optedOut.has(userId) &&
    (await SecureStore.getItemAsync(preference)) === userId
  );
}
export async function enablePush(
  userId: string,
  prompt = true,
  load: typeof nativeNotifications = nativeNotifications,
) {
  if (prompt) optedOut.delete(userId);
  else if (optedOut.has(userId)) return;
  const started = epoch,
    controller = new AbortController();
  requests.add(controller);
  const live = () =>
    identity === userId && started === epoch && !controller.signal.aborted;
  const check = () => {
    if (!live())
      throw new Error('Your session changed. Open notifications again.');
  };
  try {
    check();
    const module = await load();
    if (!module)
      throw new Error(
        'Push alerts need an installed Portl build. Your inbox works in Expo Go.',
      );
    const project = z
      .uuid()
      .safeParse(
        Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId,
      );
    if (!project.success)
      throw new Error(
        'Push setup is incomplete. Configure the EAS project before enabling alerts.',
      );
    if (Platform.OS === 'android')
      await module.setNotificationChannelAsync('gate', {
        name: 'Gate updates',
        importance: module.AndroidImportance.HIGH,
      });
    check();
    let permission = await module.getPermissionsAsync();
    if (permission.status !== 'granted' && prompt)
      permission = await module.requestPermissionsAsync();
    check();
    if (permission.status !== 'granted')
      throw new Error(
        'Notification permission is off. You can enable it in your phone’s settings. Your inbox will still work.',
      );
    const token = await module.getExpoPushTokenAsync({
      projectId: project.data,
    });
    check();
    const id = await installationId();
    check();
    await serialize(async () => {
      check();
      // Once submitted, wait for registration to settle before a queued removal.
      // Aborting HTTP here would not prove that its server transaction stopped.
      requests.delete(controller);
      await api(
        '/notifications/devices/register',
        successSchema,
        { installationId: id, token: token.data, platform: Platform.OS },
        undefined,
        userId,
      );
      check();
      await SecureStore.setItemAsync(preference, userId);
      if (!live() && (await SecureStore.getItemAsync(preference)) === userId)
        await SecureStore.deleteItemAsync(preference);
      check();
    });
  } finally {
    requests.delete(controller);
  }
}
export async function refreshPush(
  userId: string,
  load: typeof nativeNotifications = nativeNotifications,
) {
  if (await isPushEnabled(userId)) await enablePush(userId, false, load);
}
export async function disablePush(
  userId: string,
  load: typeof nativeNotifications = nativeNotifications,
) {
  optedOut.add(userId);
  cancelEnrollment();
  await serialize(async () => {
    const id = await SecureStore.getItemAsync(installation);
    if (id)
      await api(
        '/notifications/devices/remove',
        successSchema,
        { installationId: id },
        undefined,
        userId,
      );
    if ((await SecureStore.getItemAsync(preference)) === userId)
      await SecureStore.deleteItemAsync(preference);
    const module = await load();
    if (module) {
      await module.dismissAllNotificationsAsync();
      await module.clearLastNotificationResponseAsync();
    }
  });
}
export async function clearPushState() {
  setPushIdentity(null);
  if (Platform.OS === 'web') return;
  await serialize(async () => {
    await SecureStore.deleteItemAsync(preference);
    const module = await nativeNotifications();
    if (module) {
      await module.dismissAllNotificationsAsync();
      await module.clearLastNotificationResponseAsync();
    }
  });
}
