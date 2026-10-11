CREATE TABLE portl_gate."GuestPass" (
 id TEXT PRIMARY KEY, "societyId" TEXT NOT NULL, "flatId" TEXT NOT NULL,
 "issuerId" TEXT NOT NULL, "occupancyId" TEXT NOT NULL, "occupancyStartedAt" TIMESTAMP(3) NOT NULL,
 "visitorName" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "cipherText" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "validFrom" TIMESTAMP(3) NOT NULL, "validUntil" TIMESTAMP(3) NOT NULL,
 "revokedAt" TIMESTAMP(3), version INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT pass_window CHECK ("validUntil" - "validFrom" BETWEEN interval '15 minutes' AND interval '24 hours'),
 CONSTRAINT pass_version CHECK (version > 0),
 CONSTRAINT pass_society FOREIGN KEY ("societyId") REFERENCES portl_registry."Society"(id),
 CONSTRAINT pass_flat FOREIGN KEY ("societyId","flatId") REFERENCES portl_registry."Flat"("societyId",id),
 CONSTRAINT pass_occupancy FOREIGN KEY ("societyId","occupancyId") REFERENCES portl_registry."Occupancy"("societyId",id)
);
CREATE UNIQUE INDEX "GuestPass_tokenHash_key" ON portl_gate."GuestPass"("tokenHash");
CREATE UNIQUE INDEX "GuestPass_societyId_id_key" ON portl_gate."GuestPass"("societyId",id);
CREATE INDEX "GuestPass_societyId_createdAt_id_idx" ON portl_gate."GuestPass"("societyId","createdAt",id);
CREATE INDEX "GuestPass_societyId_issuerId_validUntil_idx" ON portl_gate."GuestPass"("societyId","issuerId","validUntil");
ALTER TABLE portl_gate."Visit" ALTER COLUMN "requestId" DROP NOT NULL;
ALTER TABLE portl_gate."Visit" ADD COLUMN "passId" TEXT;
ALTER TABLE portl_gate."Visit" ADD CONSTRAINT visit_source CHECK (("requestId" IS NULL) <> ("passId" IS NULL));
ALTER TABLE portl_gate."Visit" ADD CONSTRAINT "Visit_societyId_passId_fkey" FOREIGN KEY ("societyId","passId") REFERENCES portl_gate."GuestPass"("societyId",id);
CREATE UNIQUE INDEX "Visit_passId_key" ON portl_gate."Visit"("passId");
CREATE UNIQUE INDEX "Visit_societyId_passId_key" ON portl_gate."Visit"("societyId","passId");
ALTER TABLE portl_gate."GateCommandReceipt" RENAME COLUMN "requestId" TO "resourceId";
ALTER TABLE portl_gate."GateCommandReceipt" ADD COLUMN "resourceKind" TEXT NOT NULL DEFAULT 'REQUEST';
ALTER TABLE portl_gate."GateCommandReceipt" ADD CONSTRAINT receipt_kind CHECK ("resourceKind" IN ('REQUEST','PASS'));

-- Fixed, bounded predicates expose no occupancy data. The original occupancy period
-- cannot be inherited by a later resident or by reopening the same occupancy row.
CREATE FUNCTION portl_gate.is_pass_issuer(sid text, pid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT portl_registry.scoped(sid) AND EXISTS (
 SELECT 1 FROM portl_gate."GuestPass" p
 JOIN portl_registry."Occupancy" o ON o.id=p."occupancyId" AND o."societyId"=p."societyId" AND o."flatId"=p."flatId" AND o."userId"=p."issuerId" AND o."startedAt"=p."occupancyStartedAt" AND o."endedAt" IS NULL
 JOIN portl_registry."Membership" m ON m."societyId"=p."societyId" AND m."userId"=p."issuerId" AND m.role='RESIDENT' AND m.active
 WHERE p."societyId"=sid AND p.id=pid AND p."issuerId"=portl_registry.actor())
$$;
CREATE FUNCTION portl_gate.pass_issuer_current(sid text, pid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT portl_registry.scoped(sid)
 AND (portl_gate.is_guard(sid) OR portl_registry.is_admin(sid) OR portl_gate.is_pass_issuer(sid,pid))
 AND EXISTS (
 SELECT 1 FROM portl_gate."GuestPass" p
 JOIN portl_registry."Flat" f ON f.id=p."flatId" AND f."societyId"=p."societyId" AND NOT f.archived
 JOIN portl_registry."Occupancy" o ON o.id=p."occupancyId" AND o."societyId"=p."societyId" AND o."flatId"=p."flatId" AND o."userId"=p."issuerId" AND o."startedAt"=p."occupancyStartedAt" AND o."endedAt" IS NULL
 JOIN portl_registry."Membership" m ON m."societyId"=p."societyId" AND m."userId"=p."issuerId" AND m.role='RESIDENT' AND m.active
 WHERE p."societyId"=sid AND p.id=pid)
$$;
REVOKE ALL ON FUNCTION portl_gate.is_pass_issuer(text,text), portl_gate.pass_issuer_current(text,text) FROM PUBLIC;
ALTER TABLE portl_gate."GuestPass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_gate."GuestPass" FORCE ROW LEVEL SECURITY;
CREATE POLICY pass_read ON portl_gate."GuestPass" FOR SELECT USING (portl_gate.is_guard("societyId") OR portl_registry.is_admin("societyId") OR portl_gate.is_pass_issuer("societyId",id));
CREATE POLICY pass_insert ON portl_gate."GuestPass" FOR INSERT WITH CHECK (
 portl_registry.scoped("societyId") AND "issuerId"=portl_registry.actor() AND version=1 AND "revokedAt" IS NULL
 AND "validFrom" BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()+interval '7 days' AND "validUntil">clock_timestamp()
 AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Membership" m ON m."societyId"=o."societyId" AND m."userId"=o."userId" AND m.role='RESIDENT' AND m.active
 JOIN portl_registry."Flat" f ON f."societyId"=o."societyId" AND f.id=o."flatId" AND NOT f.archived
 WHERE o.id="GuestPass"."occupancyId" AND o."societyId"="GuestPass"."societyId" AND o."flatId"="GuestPass"."flatId" AND o."userId"="issuerId" AND o."startedAt"="occupancyStartedAt" AND o."endedAt" IS NULL)
);
CREATE POLICY pass_update ON portl_gate."GuestPass" FOR UPDATE USING (portl_gate.is_guard("societyId") OR portl_gate.is_pass_issuer("societyId",id)) WITH CHECK (portl_gate.is_guard("societyId") OR portl_gate.is_pass_issuer("societyId",id));
CREATE POLICY resident_flat_lock ON portl_registry."Flat" FOR UPDATE USING (
 portl_registry.scoped("societyId") AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Membership" m ON m."societyId"=o."societyId" AND m."userId"=o."userId" AND m.role='RESIDENT' AND m.active
 WHERE o."societyId"="Flat"."societyId" AND o."flatId"="Flat".id AND o."userId"=portl_registry.actor() AND o."endedAt" IS NULL)
) WITH CHECK (false);
CREATE FUNCTION portl_gate.check_pass_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'Pass version must advance once'; END IF;
 IF NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
  IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR NOT portl_gate.is_pass_issuer(OLD."societyId",OLD.id)
   OR EXISTS (SELECT 1 FROM portl_gate."Visit" v WHERE v."passId"=OLD.id) THEN RAISE EXCEPTION 'Pass cannot be revoked'; END IF;
 ELSIF NOT portl_gate.is_guard(OLD."societyId") THEN RAISE EXCEPTION 'Only guards record pass movement';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guest_pass_change BEFORE UPDATE ON portl_gate."GuestPass" FOR EACH ROW EXECUTE FUNCTION portl_gate.check_pass_change();
REVOKE ALL ON FUNCTION portl_gate.check_pass_change() FROM PUBLIC;
ALTER POLICY visit_read ON portl_gate."Visit" USING (
 EXISTS (SELECT 1 FROM portl_gate."VisitorRequest" r WHERE r.id="requestId" AND r."societyId"="Visit"."societyId")
 OR EXISTS (SELECT 1 FROM portl_gate."GuestPass" p WHERE p.id="passId" AND p."societyId"="Visit"."societyId")
);
