import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

// Exercise Expo's manifest mods, not just the source configuration array.
for (const profile of ['production', 'preview', 'development']) {
  test(`${profile} removes unused Android permissions during prebuild`, () => {
    const output = execFileSync(
      'pnpm',
      ['exec', 'expo', 'config', '--type', 'introspect', '--json'],
      {
        cwd: new URL('../../apps/mobile/', import.meta.url),
        env: {
          ...process.env,
          EAS_BUILD_PROFILE: profile,
          EXPO_NO_DOTENV: '1',
        },
        encoding: 'utf8',
      },
    );
    const config = JSON.parse(output);
    const permissions: { $: Record<string, string> }[] =
      config._internal.modResults.android.manifest.manifest['uses-permission'];
    for (const name of [
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'USE_BIOMETRIC',
      'USE_FINGERPRINT',
      ...(profile === 'development' ? [] : ['SYSTEM_ALERT_WINDOW']),
    ]) {
      const permission = permissions.find(
        (entry) => entry.$['android:name'] === `android.permission.${name}`,
      );
      assert.equal(permission?.$['tools:node'], 'remove', name);
    }
    assert.ok(
      permissions.some(
        (entry) =>
          entry.$['android:name'] === 'android.permission.INTERNET' &&
          entry.$['tools:node'] !== 'remove',
      ),
    );
    if (profile === 'development') {
      assert.ok(
        permissions.some(
          (entry) =>
            entry.$['android:name'] ===
              'android.permission.SYSTEM_ALERT_WINDOW' &&
            entry.$['tools:node'] !== 'remove',
        ),
      );
    }
  });
}
