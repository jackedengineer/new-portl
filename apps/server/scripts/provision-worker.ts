import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import pg from 'pg';
export async function provisionWorker(client: pg.Client, direct: string) {
  const url = new URL(direct),
    existing = process.env.WORKER_DATABASE_URL;
  let role: string, password: string | undefined;
  if (existing) {
    const prior = new URL(existing);
    if (
      prior.pathname !== url.pathname ||
      prior.hostname.replace('-pooler.', '.') !==
        url.hostname.replace('-pooler.', '.')
    )
      throw new Error('Worker must use the same database');
    role = decodeURIComponent(prior.username);
    if (
      process.env.DATABASE_URL &&
      role === decodeURIComponent(new URL(process.env.DATABASE_URL).username)
    )
      throw new Error('API and worker must use different database roles');
    const result = await client.query(
      `SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid) OR has_table_privilege(r.oid,'portl_auth."Session"','UPDATE') OR has_table_privilege(r.oid,'portl_gate."VisitorRequest"','UPDATE') AS unsafe FROM pg_roles r WHERE rolname=$1`,
      [role],
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0].unsafe ||
      role === decodeURIComponent(url.username)
    )
      throw new Error('Unsafe worker role');
  } else {
    role = `portl_worker_${randomBytes(6).toString('hex')}`;
    password = randomBytes(48).toString('base64url');
  }
  const who = pg.escapeIdentifier(role);
  await client.query('BEGIN');
  try {
    if (password)
      await client.query(
        `CREATE ROLE ${who} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
      );
    await client.query(
      `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(decodeURIComponent(url.pathname.slice(1)))} TO ${who}`,
    );
    await client.query(
      `GRANT USAGE ON SCHEMA portl_notifications,portl_jobs TO ${who}`,
    );
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA portl_jobs TO ${who}`,
    );
    await client.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA portl_jobs TO ${who}`,
    );
    await client.query(
      `GRANT SELECT,INSERT,UPDATE ON portl_notifications."Delivery" TO ${who}`,
    );
    await client.query(
      `DROP POLICY IF EXISTS delivery_worker ON portl_notifications."Delivery"`,
    );
    await client.query(
      `CREATE POLICY delivery_worker ON portl_notifications."Delivery" TO ${who} USING (true) WITH CHECK (true)`,
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION portl_notifications.delivery_targets(text),portl_notifications.retire_device(text,text),portl_notifications.cleanup() TO ${who}`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  if (password) {
    url.username = role;
    url.password = password;
    const source = await readFile('.env', 'utf8'),
      line = `WORKER_DATABASE_URL="${url.toString()}"`;
    const next = /^WORKER_DATABASE_URL=.*$/m.test(source)
      ? source.replace(/^WORKER_DATABASE_URL=.*$/m, () => line)
      : `${source}\n${line}\n`;
    await writeFile('.env.worker.tmp', next, { mode: 0o600, flag: 'wx' });
    await rename('.env.worker.tmp', '.env');
    await chmod('.env', 0o600);
  }
  console.log(
    'Restricted notification worker grants ready; credentials remain private.',
  );
}
