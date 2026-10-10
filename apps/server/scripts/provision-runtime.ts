import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

import pg from 'pg';

import { grantRuntime } from '../src/database/runtime-grants.js';

import { postgresOptions } from '../src/database/connection.js';

// Run after migrations, against the development branch only. Never print credentials.
async function provision() {
  const direct = process.env.DIRECT_DATABASE_URL;
  if (!direct) throw new Error('DIRECT_DATABASE_URL is required');
  if (process.env.NODE_ENV === 'production')
    throw new Error('Local provisioning is development-only');
  const client = new pg.Client(postgresOptions(direct));
  await client.connect();
  try {
    const existing = process.env.DATABASE_URL;
    const ownerUrl = new URL(direct);
    const runtimeUrl = new URL(existing || direct);
    if (
      runtimeUrl.pathname !== ownerUrl.pathname ||
      runtimeUrl.hostname.replace('-pooler.', '.') !==
        ownerUrl.hostname.replace('-pooler.', '.')
    ) {
      throw new Error('Connections must target the same development database');
    }
    if (existing && runtimeUrl.username !== ownerUrl.username) {
      const role = decodeURIComponent(runtimeUrl.username);
      const result = await client.query(
        'SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole AS unsafe FROM pg_roles WHERE rolname = $1',
        [role],
      );
      if (result.rows.length !== 1 || result.rows[0].unsafe)
        throw new Error('Unsafe runtime role');
      await grantRuntime(client, role);
      console.log('Restricted runtime grants updated; credentials unchanged.');
      return;
    }
    const role = `portl_runtime_${randomBytes(6).toString('hex')}`;
    const password = randomBytes(48).toString('base64url');
    const identifier = pg.escapeIdentifier(role);
    await client.query('BEGIN');
    try {
      await client.query(
        `CREATE ROLE ${identifier} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
      );
      await client.query(
        `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(decodeURIComponent(ownerUrl.pathname.slice(1)))} TO ${identifier}`,
      );
      await grantRuntime(client, role);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const path = '.env';
    const source = await readFile(path, 'utf8');
    const line = `DATABASE_URL="${runtimeUrl.toString()}"`;
    const next = /^DATABASE_URL=.*$/m.test(source)
      ? source.replace(/^DATABASE_URL=.*$/m, () => line)
      : `${source}\n${line}\n`;
    await writeFile(`${path}.runtime.tmp`, next, { mode: 0o600, flag: 'wx' });
    await rename(`${path}.runtime.tmp`, path);
    await chmod(path, 0o600);
    console.log(
      'Restricted runtime role created; DATABASE_URL updated in the ignored local environment file.',
    );
  } finally {
    await client.end();
  }
}

provision().catch(() => {
  console.error(
    'Runtime provisioning failed. Verify the development migration URL and schema; no credentials were printed.',
  );
  process.exitCode = 1;
});
