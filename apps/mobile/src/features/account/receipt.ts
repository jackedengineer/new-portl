import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
const key = 'portl.deletion-receipt';
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export async function saveReceipt(token: string) {
  if (Platform.OS !== 'web')
    await SecureStore.setItemAsync(
      key,
      JSON.stringify({ token, expiresAt: Date.now() + 90 * 86400000 }),
      options,
    );
}
export async function clearReceipt() {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key, options);
}
export async function loadReceipt() {
  if (Platform.OS === 'web') return '';
  const text = await SecureStore.getItemAsync(key, options);
  if (!text) return '';
  try {
    const value: unknown = JSON.parse(text);
    if (
      value &&
      typeof value === 'object' &&
      'token' in value &&
      'expiresAt' in value &&
      typeof value.token === 'string' &&
      /^[a-f0-9]{64}$/.test(value.token) &&
      typeof value.expiresAt === 'number' &&
      value.expiresAt > Date.now()
    )
      return value.token;
  } catch {
    /* Invalid local receipt is discarded. */
  }
  await clearReceipt();
  return '';
}
