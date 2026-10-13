-- Erase only subjects already persisted in the private external restore ledger.
DROP FUNCTION portl_auth.process_account_deletion();
CREATE FUNCTION portl_auth.process_account_deletion(ledger_subjects text[]) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job portl_auth."AccountDeletion"; uid text; address text; request_ids text[]; pass_ids text[]; notice_ids text[]; visit_ids text[];
BEGIN
 SELECT * INTO job FROM portl_auth."AccountDeletion" WHERE status='PENDING' AND "subjectHash"=ANY(ledger_subjects) AND "nextAttemptAt"<=now() ORDER BY "requestedAt" LIMIT 1 FOR UPDATE SKIP LOCKED;
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
REVOKE ALL ON FUNCTION portl_auth.process_account_deletion(text[]) FROM PUBLIC;

