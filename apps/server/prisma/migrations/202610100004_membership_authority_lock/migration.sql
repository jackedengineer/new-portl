-- Row locks use UPDATE visibility. Permit locking current admin authority while denying writes to admin rows.
CREATE POLICY membership_admin_lock ON portl_registry."Membership" FOR UPDATE
  USING (portl_registry.scoped("societyId") AND role = 'ADMIN') WITH CHECK (false);
