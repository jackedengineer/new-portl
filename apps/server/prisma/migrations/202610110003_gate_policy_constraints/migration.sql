-- PostgreSQL OR-combines permissive policies. Repeat authorization in write
-- checks so a lock-only USING policy cannot widen the older write policies.
ALTER POLICY membership_update ON portl_registry."Membership" WITH CHECK (
 role = 'RESIDENT' AND portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
);
ALTER POLICY occupancy_update ON portl_registry."Occupancy" WITH CHECK (
 portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
);
CREATE UNIQUE INDEX "Occupancy_societyId_id_key" ON portl_registry."Occupancy" ("societyId",id);
ALTER TABLE portl_gate."RequestRecipient" DROP CONSTRAINT recipient_occupancy;
ALTER TABLE portl_gate."RequestRecipient" ADD CONSTRAINT recipient_occupancy FOREIGN KEY ("societyId","occupancyId") REFERENCES portl_registry."Occupancy"("societyId",id);
CREATE OR REPLACE FUNCTION portl_gate.check_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Visitor version must advance once'; END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
  IF NEW."approvedUntil" IS DISTINCT FROM OLD."approvedUntil" OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt" OR NEW."decidedBy" IS DISTINCT FROM OLD."decidedBy" THEN RAISE EXCEPTION 'Decision metadata is immutable'; END IF;
  IF NOT portl_gate.is_guard(NEW."societyId") THEN RAISE EXCEPTION 'Only guards record movement'; END IF;
 ELSE
  IF OLD.status <> 'PENDING' OR OLD."expiresAt" <= clock_timestamp() THEN RAISE EXCEPTION 'Visitor decision unavailable'; END IF;
  IF NEW.status IN ('APPROVED','REJECTED') AND NOT (NEW."decidedBy" = portl_registry.actor() AND portl_gate.is_recipient(NEW."societyId",NEW.id,portl_registry.actor())) THEN RAISE EXCEPTION 'Resident decision required'; END IF;
  IF NEW.status = 'CANCELLED' AND NOT portl_gate.is_guard(NEW."societyId") THEN RAISE EXCEPTION 'Guard required'; END IF;
 END IF;
 RETURN NEW;
END $$;
