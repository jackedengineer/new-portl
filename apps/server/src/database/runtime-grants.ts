import pg from 'pg';

export async function grantRuntime(client: pg.Client, role: string) {
  const who = pg.escapeIdentifier(role);
  await client.query(
    `GRANT USAGE ON SCHEMA portl_auth, portl_registry TO ${who}`,
  );
  for (const table of [
    'User',
    'Session',
    'Account',
    'Verification',
    'RateLimit',
    'OtpThrottle',
    'TwoFactor',
    'AdminAssurance',
    'AdminTotpUse',
  ]) {
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON portl_auth.${pg.escapeIdentifier(table)} TO ${who}`,
    );
  }
  for (const table of [
    'Society',
    'Tower',
    'Flat',
    'Membership',
    'Occupancy',
    'Invitation',
    'ResidentApplication',
    'RegistryAudit',
  ]) {
    await client.query(
      `GRANT SELECT ON portl_registry.${pg.escapeIdentifier(table)} TO ${who}`,
    );
  }
  for (const table of [
    'Membership',
    'Occupancy',
    'Invitation',
    'ResidentApplication',
    'RegistryAudit',
  ]) {
    await client.query(
      `GRANT INSERT ON portl_registry.${pg.escapeIdentifier(table)} TO ${who}`,
    );
  }
  const updates = {
    Membership: ['active'],
    Occupancy: ['relationship', 'startedAt', 'endedAt'],
    Invitation: ['acceptedAt', 'acceptedBy', 'revokedAt'],
    ResidentApplication: ['status', 'reason', 'decidedAt', 'decidedBy'],
  };
  for (const [table, columns] of Object.entries(updates)) {
    await client.query(
      `GRANT UPDATE (${columns.map(pg.escapeIdentifier).join(',')}) ON portl_registry.${pg.escapeIdentifier(table)} TO ${who}`,
    );
  }
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_registry.actor(), portl_registry.scoped(text), portl_registry.is_admin(text) TO ${who}`,
  );
}
