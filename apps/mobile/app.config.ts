/// <reference types="node" />
import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (
    projectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId,
    )
  )
    throw new Error(
      'EXPO_PUBLIC_EAS_PROJECT_ID must be the real EAS project UUID',
    );
  const googleServices =
    process.env.GOOGLE_SERVICES_JSON || '.local/google-services.json';
  if (process.env.GOOGLE_SERVICES_JSON && !existsSync(googleServices))
    throw new Error(
      'GOOGLE_SERVICES_JSON must point to an existing Firebase Android configuration file',
    );
  return {
    ...config,
    name: config.name ?? 'Portl',
    slug: config.slug ?? 'portl',
    ios: { ...config.ios, bundleIdentifier: 'dev.jacked.portl' },
    android: {
      ...config.android,
      package: 'dev.jacked.portl',
      ...(existsSync(googleServices)
        ? { googleServicesFile: googleServices }
        : {}),
    },
    plugins: [...(config.plugins ?? []), 'expo-notifications'],
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
  };
};
