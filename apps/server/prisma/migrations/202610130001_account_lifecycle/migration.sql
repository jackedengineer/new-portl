ALTER TABLE portl_auth."User" ADD COLUMN "deletionRequestedAt" timestamp(3);
CREATE TABLE portl_auth."AccountPolicy" (
 "userId" text PRIMARY KEY REFERENCES portl_auth."User"(id) ON DELETE CASCADE,
 version text NOT NULL, adult boolean NOT NULL CHECK (adult), "acceptedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE TABLE portl_auth."DeletionChallenge" (
 id text PRIMARY KEY, "userId" text NOT NULL REFERENCES portl_auth."User"(id) ON DELETE CASCADE,
 email text NOT NULL, digest text NOT NULL, "receiptHash" text NOT NULL UNIQUE,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
 "expiresAt" timestamp(3) NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "DeletionChallenge_userId_idx" ON portl_auth."DeletionChallenge"("userId");
CREATE INDEX "DeletionChallenge_expiresAt_idx" ON portl_auth."DeletionChallenge"("expiresAt");
CREATE TABLE portl_auth."AccountDeletion" (
 id text PRIMARY KEY, "userId" text UNIQUE, "subjectHash" text NOT NULL,
 "emailHash" text, "receiptHash" text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED')),
 "requestedAt" timestamp(3) NOT NULL DEFAULT now(), "completedAt" timestamp(3),
 attempts integer NOT NULL DEFAULT 0, "nextAttemptAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "AccountDeletion_status_nextAttemptAt_idx" ON portl_auth."AccountDeletion"(status,"nextAttemptAt");

-- Erasure changes only the identifying actor on a surviving decision. A runtime
-- caller cannot activate this exception with a forged GUC: ownership is checked.
CREATE OR REPLACE FUNCTION portl_gate.check_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='portl_gate."VisitorRequest"'::regclass))
 AND OLD."decidedBy"=current_setting('portl.erasing_user',true) AND NEW."decidedBy"='deleted-account'
 AND NEW.version=OLD.version+1
 AND (to_jsonb(NEW)-'decidedBy'-'version')=(to_jsonb(OLD)-'decidedBy'-'version') THEN RETURN NEW; END IF;
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

CREATE FUNCTION portl_auth.revoke_account_devices(uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Only a current session or a queued, verified deletion can revoke devices.
 IF NOT EXISTS (SELECT 1 FROM portl_auth."AccountDeletion" WHERE "userId"=uid AND status='PENDING')
 AND NOT EXISTS (SELECT 1 FROM portl_auth."Session" WHERE id=current_setting('portl.session_id',true) AND "userId"=uid AND "expiresAt">clock_timestamp()) THEN RAISE EXCEPTION 'Account authorization required'; END IF;
 DELETE FROM portl_notifications."Delivery" WHERE "deviceId" IN (SELECT id FROM portl_notifications."PushDevice" WHERE "userId"=uid);
 DELETE FROM portl_notifications."PushDevice" WHERE "userId"=uid;
END $$;
REVOKE ALL ON FUNCTION portl_auth.revoke_account_devices(text) FROM PUBLIC;

-- A dedicated worker receives EXECUTE only, not broad domain DELETE privileges.
-- One transaction claims one durable request and either erases it fully or retries.
CREATE FUNCTION portl_auth.process_account_deletion() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job portl_auth."AccountDeletion"; uid text; address text; request_ids text[]; pass_ids text[]; notice_ids text[]; visit_ids text[];
BEGIN
 SELECT * INTO job FROM portl_auth."AccountDeletion" WHERE status='PENDING' AND "nextAttemptAt"<=now() ORDER BY "requestedAt" LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 'IDLE'; END IF;
 BEGIN
  uid:=job."userId";
  SELECT email INTO address FROM portl_auth."User" WHERE id=uid AND "deletionRequestedAt" IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deletion subject unavailable'; END IF;
  PERFORM set_config('portl.erasing_user',uid,true);
  SELECT coalesce(array_agg(id),ARRAY[]::text[]) INTO request_ids FROM portl_gate."VisitorRequest" WHERE "createdBy"=uid;
  SELECT coalesce(array_agg(id),ARRAY[]::text[]) INTO pass_ids FROM portl_gate."GuestPass" WHERE "issuerId"=uid;
  SELECT coalesce(array_agg(id),ARRAY[]::text[]) INTO notice_ids FROM portl_community."Notice" WHERE "createdBy"=uid;
  SELECT coalesce(array_agg(id),ARRAY[]::text[]) INTO visit_ids FROM portl_gate."Visit" WHERE "requestId"=ANY(request_ids) OR "passId"=ANY(pass_ids);
  DELETE FROM portl_notifications."Notification" WHERE "userId"=uid OR ("resourceKind"='REQUEST' AND "resourceId"=ANY(request_ids)) OR ("resourceKind"='PASS' AND "resourceId"=ANY(pass_ids)) OR ("resourceKind"='NOTICE' AND "resourceId"=ANY(notice_ids));
  PERFORM portl_auth.revoke_account_devices(uid);
  DELETE FROM portl_gate."MovementEvent" WHERE "visitId"=ANY(visit_ids);
  DELETE FROM portl_gate."Visit" WHERE id=ANY(visit_ids);
  DELETE FROM portl_gate."RequestRecipient" WHERE "userId"=uid OR "requestId"=ANY(request_ids);
  DELETE FROM portl_gate."VisitorRequest" WHERE id=ANY(request_ids);
  DELETE FROM portl_gate."GuestPass" WHERE id=ANY(pass_ids);
  DELETE FROM portl_gate."GateCommandReceipt" WHERE "actorId"=uid OR ("resourceKind"='REQUEST' AND "resourceId"=ANY(request_ids)) OR ("resourceKind"='PASS' AND "resourceId"=ANY(pass_ids));
  DELETE FROM portl_community."Notice" WHERE id=ANY(notice_ids);
  UPDATE portl_gate."VisitorRequest" SET "decidedBy"='deleted-account',version=version+1 WHERE "decidedBy"=uid;
  UPDATE portl_gate."Visit" SET "enteredBy"='deleted-account' WHERE "enteredBy"=uid;
  UPDATE portl_gate."Visit" SET "exitedBy"='deleted-account' WHERE "exitedBy"=uid;
  UPDATE portl_gate."MovementEvent" SET "actorId"='deleted-account' WHERE "actorId"=uid;
  DELETE FROM portl_registry."RegistryAudit" WHERE "actorId"=uid OR "resourceId"=uid
    OR "resourceId" IN (SELECT id FROM portl_registry."Occupancy" WHERE "userId"=uid)
    OR "resourceId" IN (SELECT id FROM portl_registry."ResidentApplication" WHERE "userId"=uid)
    OR "resourceId" IN (SELECT id FROM portl_registry."Invitation" WHERE email=address OR "createdBy"=uid OR "acceptedBy"=uid)
    OR "resourceId" IN (SELECT id FROM portl_registry."GuardAssignment" WHERE "userId"=uid)
    OR "resourceId"=ANY(request_ids) OR "resourceId"=ANY(pass_ids) OR "resourceId"=ANY(notice_ids);
  DELETE FROM portl_registry."Invitation" WHERE email=address OR "createdBy"=uid OR "acceptedBy"=uid;
  DELETE FROM portl_registry."GuardAssignment" WHERE "userId"=uid;
  UPDATE portl_registry."GuardAssignment" SET "createdBy"='deleted-account' WHERE "createdBy"=uid;
  UPDATE portl_registry."ResidentApplication" SET "decidedBy"='deleted-account' WHERE "decidedBy"=uid;
  DELETE FROM portl_auth."Verification" WHERE identifier IN ('sign-in-otp-'||address,'email-verification-otp-'||address)
    OR identifier LIKE 'change-email-otp-'||replace(replace(replace(address,'\','\\'),'%','\%'),'_','\_')||'-%';
  DELETE FROM portl_auth."User" WHERE id=uid;
  UPDATE portl_auth."AccountDeletion" SET "userId"=NULL,status='COMPLETED',"completedAt"=clock_timestamp(),attempts=attempts+1 WHERE id=job.id;
  RETURN 'COMPLETED';
 EXCEPTION WHEN OTHERS THEN
  UPDATE portl_auth."AccountDeletion" SET attempts=LEAST(attempts+1,100000),"nextAttemptAt"=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7)))::integer) WHERE id=job.id;
  RETURN 'RETRY';
 END;
END $$;
REVOKE ALL ON FUNCTION portl_auth.process_account_deletion() FROM PUBLIC;

CREATE FUNCTION portl_auth.cleanup_account_metadata() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM portl_auth."DeletionChallenge" WHERE "expiresAt"<now();
 DELETE FROM portl_auth."Verification" WHERE "expiresAt"<now();
 DELETE FROM portl_auth."OtpThrottle" WHERE "resetAt"<now();
 UPDATE portl_auth."AccountDeletion" SET "emailHash"=NULL WHERE "requestedAt"<now()-interval '10 minutes' AND "emailHash" IS NOT NULL;
 DELETE FROM portl_auth."AccountDeletion" WHERE status='COMPLETED' AND "completedAt"<now()-interval '90 days';
END $$;
REVOKE ALL ON FUNCTION portl_auth.cleanup_account_metadata() FROM PUBLIC;
