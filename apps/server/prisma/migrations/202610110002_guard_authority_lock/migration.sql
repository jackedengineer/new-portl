-- SELECT FOR SHARE requires an UPDATE USING policy, but this grants no writes.
CREATE POLICY guard_resident_authority_lock ON portl_registry."Membership" FOR UPDATE
 USING (role = 'RESIDENT' AND portl_gate.is_guard("societyId")) WITH CHECK (false);
