import pg from 'pg';

export async function grantRuntime(client: pg.Client, role: string) {
  const who = pg.escapeIdentifier(role);
  await client.query(
    `GRANT USAGE ON SCHEMA portl_auth, portl_registry, portl_gate TO ${who}`,
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
    'Gate',
    'GuardAssignment',
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
    'Gate',
    'GuardAssignment',
  ]) {
    await client.query(
      `GRANT INSERT ON portl_registry.${pg.escapeIdentifier(table)} TO ${who}`,
    );
  }
  const updates = {
    Gate: ['active'],
    Flat: ['archived'],
    Society: ['archived'],
    GuardAssignment: ['active'],
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
  for (const table of [
    'VisitorRequest',
    'RequestRecipient',
    'Visit',
    'MovementEvent',
    'GateCommandReceipt',
  ]) {
    await client.query(
      `GRANT SELECT, INSERT ON portl_gate.${pg.escapeIdentifier(table)} TO ${who}`,
    );
  }
  await client.query(
    `GRANT UPDATE (status, version, "approvedUntil", "decidedBy", "decidedAt") ON portl_gate."VisitorRequest" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE ("exitedAt", "exitedBy") ON portl_gate."Visit" TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_gate.is_guard(text), portl_gate.is_recipient(text,text,text), portl_gate.check_decision(), portl_gate.approval_current(text,text) TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_registry.actor(), portl_registry.scoped(text), portl_registry.is_admin(text) TO ${who}`,
  );
}
