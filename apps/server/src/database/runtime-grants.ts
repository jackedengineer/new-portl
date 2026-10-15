import pg from 'pg';

export async function grantRuntime(client: pg.Client, role: string) {
  const who = pg.escapeIdentifier(role);
  await client.query(`GRANT SELECT ON portl_auth."ReviewLifecycle" TO ${who}`);
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON portl_auth."ReviewLifecycleCode" TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_auth.allocate_review_lifecycle(text,text,text,text),portl_auth.lifecycle_parent_allowed(text) TO ${who}`,
  );
  await client.query(
    `GRANT SELECT ON portl_auth."ReviewRealm",portl_auth."ReviewerAccount",portl_auth."ReviewerSession" TO ${who}`,
  );
  await client.query(`GRANT INSERT ON portl_auth."ReviewerSession" TO ${who}`);
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_auth.reviewer_session_allowed(text,text),portl_auth.reviewer_society_allowed(text),portl_auth.reviewer_target_allowed(text,text,text) TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_auth.admin_recovery_view(text,text),portl_auth.complete_admin_recovery(text,text,text,text,boolean,text) TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_auth.revoke_account_devices(text), portl_auth.revoke_session_devices(text,text) TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_registry.is_current_resident(text),portl_registry.active_admin(text) TO ${who}`,
  );
  await client.query(
    `GRANT SELECT, INSERT ON portl_registry."DirectoryEntry", portl_registry."DirectoryContact" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE (name,kind,service,description,archived,version) ON portl_registry."DirectoryEntry" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE (phone,"sharePhone") ON portl_registry."DirectoryContact" TO ${who}`,
  );
  await client.query(
    `GRANT INSERT ON portl_registry."Tower",portl_registry."Flat" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE (name,archived,version) ON portl_registry."Tower" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE (label,version) ON portl_registry."Flat" TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_registry.check_flat_tower(),portl_registry.check_admission_flat() TO ${who}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA portl_community TO ${who}`);
  await client.query(
    `GRANT SELECT, INSERT ON portl_community."Notice" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE (title,body,status,version,"updatedAt","publishedAt","archivedAt") ON portl_community."Notice" TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_community.is_resident(text),portl_community.active_admin(text),portl_community.check_notice_change(),portl_community.notify_notice(text) TO ${who}`,
  );
  await client.query(
    `GRANT USAGE ON SCHEMA portl_notifications, portl_jobs TO ${who}`,
  );
  await client.query(
    `GRANT SELECT ON portl_notifications."Notification" TO ${who}`,
  );
  await client.query(
    `GRANT UPDATE ("readAt") ON portl_notifications."Notification" TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_notifications.eligible(portl_notifications."Notification"), portl_notifications.register_device(text,text,text,text,text), portl_notifications.remove_device(text), portl_gate.notify_request(text), portl_gate.notify_pass(text) TO ${who}`,
  );
  await client.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA portl_jobs TO ${who}`,
  );
  await client.query(
    `GRANT INSERT ON portl_jobs.job, portl_jobs.job_common TO ${who}`,
  );

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
    'AccountPolicy',
    'DeletionChallenge',
    'AccountDeletion',
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
    'GuestPass',
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
    `GRANT UPDATE (version, "revokedAt") ON portl_gate."GuestPass" TO ${who}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION portl_gate.is_pass_issuer(text,text), portl_gate.pass_issuer_current(text,text), portl_gate.check_pass_change() TO ${who}`,
  );
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
