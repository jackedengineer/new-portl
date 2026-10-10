import { spawnSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production')
  throw new Error('Integration tests must not target production');
const url = process.env.PORTL_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url)
  throw new Error(
    'Configure an isolated development/test DATABASE_URL or PORTL_TEST_DATABASE_URL',
  );

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.integration.config.ts',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', PORTL_TEST_DATABASE_URL: url },
  },
);
process.exitCode = result.status ?? 1;
