import { createAuthClient } from 'better-auth/react';
import { emailOTPClient, twoFactorClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

const rawURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
const url = new URL(rawURL);
if (
  !['https:', 'http:'].includes(url.protocol) ||
  (!__DEV__ && url.protocol !== 'https:') ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== '/'
) {
  throw new Error(
    'Configure EXPO_PUBLIC_API_URL with a valid API origin; release builds require HTTPS',
  );
}
export const apiURL = url.origin;
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const authClient = createAuthClient({
  baseURL: apiURL,
  fetchOptions: { timeout: 15_000, retry: 0 },
  plugins: [
    emailOTPClient(),
    twoFactorClient(),
    expoClient({
      scheme: 'portl',
      storagePrefix: 'portl',
      cookiePrefix: 'portl',
      disableCache: true,
      storage: {
        getItem: (key: string) => SecureStore.getItem(key, options),
        setItem: (key: string, value: string) =>
          SecureStore.setItem(key, value, options),
        getItemAsync: (key: string) => SecureStore.getItemAsync(key, options),
        setItemAsync: (key: string, value: string) =>
          SecureStore.setItemAsync(key, value, options),
      },
    }),
  ],
});
