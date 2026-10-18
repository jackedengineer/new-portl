-- Private content projection. Only the checked inbox/delivery wrappers may call it.
CREATE FUNCTION portl_notifications.preview_context(nid text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
   'visitorName',coalesce(r."visitorName",p."visitorName"),
   'gateName',g.name,
   'noticeTitle',x.title,
   'noticeBody',left(x.body,500))
 FROM portl_notifications."Notification" n
 LEFT JOIN portl_gate."VisitorRequest" r ON n."resourceKind"='REQUEST' AND r.id=n."resourceId" AND r."societyId"=n."societyId"
 LEFT JOIN portl_gate."GuestPass" p ON n."resourceKind"='PASS' AND p.id=n."resourceId" AND p."societyId"=n."societyId"
 LEFT JOIN portl_gate."Visit" v ON v."societyId"=n."societyId" AND (v."requestId"=r.id OR v."passId"=p.id)
 LEFT JOIN portl_gate."MovementEvent" e ON e."visitId"=v.id AND e."societyId"=n."societyId" AND e.type::text=CASE
   WHEN n.type IN ('VISITOR_ENTERED','GUEST_ENTERED') THEN 'ENTRY'
   WHEN n.type IN ('VISITOR_EXITED','GUEST_EXITED') THEN 'EXIT' END
 LEFT JOIN portl_registry."Gate" g ON g."societyId"=n."societyId" AND g.id=CASE
   WHEN n.type IN ('VISITOR_ENTERED','VISITOR_EXITED','GUEST_ENTERED','GUEST_EXITED') THEN e."gateId"
   ELSE r."gateId" END
 LEFT JOIN portl_community."Notice" x ON n."resourceKind"='NOTICE' AND x.id=n."resourceId" AND x."societyId"=n."societyId" AND x.status='PUBLISHED'
 WHERE n.id=nid
$$;
REVOKE ALL ON FUNCTION portl_notifications.preview_context(text) FROM PUBLIC;

CREATE FUNCTION portl_notifications.inbox_previews(nids text[]) RETURNS TABLE(id text,context jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT n.id,portl_notifications.preview_context(n.id)
 FROM portl_notifications."Notification" n
 JOIN portl_auth."AccountPolicy" p ON p."userId"=n."userId" AND p.adult AND p.version='2026-10-18'
 WHERE cardinality(nids) BETWEEN 1 AND 31 AND n.id=ANY(nids) AND portl_notifications.eligible(n)
$$;
REVOKE ALL ON FUNCTION portl_notifications.inbox_previews(text[]) FROM PUBLIC;

-- Preserve token/session/grant revalidation. Personal content is released only
-- after the recipient accepted the new policy; older acceptances get generic copy.
CREATE FUNCTION portl_notifications.delivery_previews(nid text)
RETURNS TABLE("deviceId" text,generation text,"cipherText" text,type text,"expiresAt" timestamp(3),context jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.*,CASE WHEN p.adult AND p.version='2026-10-18'
   THEN coalesce(portl_notifications.preview_context(n.id),'{}'::jsonb)
   ELSE '{}'::jsonb END
 FROM portl_notifications.delivery_targets(nid) t
 JOIN portl_notifications."Notification" n ON n.id=nid
 LEFT JOIN portl_auth."AccountPolicy" p ON p."userId"=n."userId"
$$;
REVOKE ALL ON FUNCTION portl_notifications.delivery_previews(text) FROM PUBLIC;

-- Advance the recovery policy guards with the API/mobile acceptance contract.
-- Existing account acceptance is preserved and must be renewed by the user.
CREATE OR REPLACE FUNCTION portl_auth.admin_recovery_view(uid text,sid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM portl_auth."User" u JOIN portl_auth."Session" s ON s."userId"=u.id JOIN portl_auth."AccountPolicy" p ON p."userId"=u.id
 WHERE u.id=uid AND s.id=sid AND s."expiresAt">clock_timestamp() AND u."emailVerified" AND u."deletionRequestedAt" IS NULL AND p.adult AND p.version='2026-10-18') THEN RAISE EXCEPTION 'Account authorization required'; END IF;
 SELECT jsonb_build_object('id',r.id,'operation',r.operation,'email',r.email,'societyName',soc.name,'encryptedSecret',r."encryptedSecret",'expiresAt',r."expiresAt") INTO result
 FROM portl_auth."OperatorRecovery" r JOIN portl_auth."User" u ON u.id=r."userId" LEFT JOIN portl_registry."Society" soc ON soc.id=r."societyId"
 WHERE r."userId"=uid AND r.email=u.email AND r.status='PENDING' AND r.attempts<3 AND r."expiresAt">clock_timestamp()
 AND (r."societyId" IS NULL OR NOT soc.archived) LIMIT 1;
 RETURN jsonb_build_object('request',result,'completedAt',(SELECT max("completedAt") FROM portl_auth."OperatorRecovery" WHERE "userId"=uid AND status='COMPLETED'));
END $$;
REVOKE ALL ON FUNCTION portl_auth.admin_recovery_view(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION portl_auth.complete_admin_recovery(rid text,uid text,sid text,email_proof text,totp_verified boolean,used_code_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u portl_auth."User"; r portl_auth."OperatorRecovery"; factor_hash text; audit_society text;
BEGIN
 SELECT * INTO u FROM portl_auth."User" WHERE id=uid FOR UPDATE;
 IF NOT FOUND OR NOT u."emailVerified" OR u."deletionRequestedAt" IS NOT NULL THEN RETURN 'UNAVAILABLE'; END IF;
 IF NOT EXISTS (SELECT 1 FROM portl_auth."Session" WHERE id=sid AND "userId"=uid AND "expiresAt">clock_timestamp() FOR SHARE)
 OR NOT EXISTS (SELECT 1 FROM portl_auth."AccountPolicy" WHERE "userId"=uid AND adult AND version='2026-10-18') THEN RETURN 'UNAVAILABLE'; END IF;
 SELECT * INTO r FROM portl_auth."OperatorRecovery" WHERE id=rid AND "userId"=uid FOR UPDATE;
 IF NOT FOUND THEN RETURN 'INVALID'; END IF;
 IF r.status='COMPLETED' THEN RETURN 'COMPLETED'; END IF;
 IF r.status<>'PENDING' OR r."expiresAt"<=clock_timestamp() OR r.attempts>=3 OR r.email<>u.email THEN RETURN 'INVALID'; END IF;
 IF email_proof IS DISTINCT FROM r."otpHash" OR NOT coalesce(totp_verified,false) THEN
  UPDATE portl_auth."OperatorRecovery" SET attempts=attempts+1 WHERE id=rid;
  IF r.attempts=2 THEN UPDATE portl_auth."OperatorRecovery" SET status='CANCELLED',"completedAt"=clock_timestamp(),"otpHash"=NULL,"encryptedSecret"=NULL,"expectedFactorHash"=NULL WHERE id=rid; END IF;
  RETURN 'INVALID';
 END IF;
 SELECT encode(sha256(convert_to(coalesce((SELECT secret FROM portl_auth."TwoFactor" WHERE "userId"=uid),''),'UTF8')),'hex') INTO factor_hash;
 IF factor_hash IS DISTINCT FROM r."expectedFactorHash" THEN RETURN 'CHANGED'; END IF;
 IF r.operation='RESTORE_ADMIN' THEN
  PERFORM id FROM portl_registry."Society" WHERE id=r."societyId" AND NOT archived FOR UPDATE;
  IF NOT FOUND THEN RETURN 'CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM portl_registry."Membership" m JOIN portl_auth."User" a ON a.id=m."userId" WHERE m."societyId"=r."societyId" AND m.role='ADMIN' AND m.active AND a."deletionRequestedAt" IS NULL) THEN RETURN 'CHANGED'; END IF;
 ELSE
  IF NOT EXISTS (SELECT 1 FROM portl_registry."Membership" m JOIN portl_registry."Society" soc ON soc.id=m."societyId" WHERE m."userId"=uid AND m.role='ADMIN' AND m.active AND NOT soc.archived) THEN RETURN 'CHANGED'; END IF;
 END IF;
 -- Authority locks can wait past the proof or session deadline.
 IF r."expiresAt"<=clock_timestamp() OR NOT EXISTS (SELECT 1 FROM portl_auth."Session" WHERE id=sid AND "userId"=uid AND "expiresAt">clock_timestamp()) THEN RETURN 'INVALID'; END IF;
 INSERT INTO portl_auth."TwoFactor" (id,"userId",secret,"backupCodes",verified,"failedVerificationCount","lockedUntil")
 VALUES (gen_random_uuid()::text,uid,r."encryptedSecret",'[]',true,0,NULL)
 ON CONFLICT ("userId") DO UPDATE SET secret=excluded.secret,"backupCodes"='[]',verified=true,"failedVerificationCount"=0,"lockedUntil"=NULL;
 UPDATE portl_auth."User" SET "twoFactorEnabled"=true,"updatedAt"=clock_timestamp() WHERE id=uid;
 IF r.operation='RESTORE_ADMIN' THEN
  INSERT INTO portl_registry."Membership" (id,"societyId","userId",role,active,"grantVersion") VALUES (gen_random_uuid()::text,r."societyId",uid,'ADMIN',true,1)
  ON CONFLICT ("societyId","userId",role) DO UPDATE SET active=true,"grantVersion"=portl_registry."Membership"."grantVersion"+1;
 END IF;
 DELETE FROM portl_notifications."Delivery" WHERE "deviceId" IN (SELECT id FROM portl_notifications."PushDevice" WHERE "userId"=uid);
 DELETE FROM portl_notifications."PushDevice" WHERE "userId"=uid;
 DELETE FROM portl_auth."Session" WHERE "userId"=uid;
 DELETE FROM portl_auth."DeletionChallenge" WHERE "userId"=uid;
 DELETE FROM portl_auth."AdminTotpUse" WHERE "userId"=uid;
 INSERT INTO portl_auth."AdminTotpUse" ("userId",digest,"expiresAt") VALUES (uid,used_code_digest,clock_timestamp()+interval '90 seconds');
 DELETE FROM portl_auth."Verification" WHERE identifier IN ('sign-in-otp-'||u.email,'email-verification-otp-'||u.email)
 OR identifier LIKE 'change-email-otp-'||replace(replace(replace(u.email,'\','\\'),'%','\%'),'_','\_')||'-%';
 UPDATE portl_auth."OperatorRecovery" SET status='COMPLETED',"completedAt"=clock_timestamp(),"otpHash"=NULL,"encryptedSecret"=NULL,"expectedFactorHash"=NULL WHERE id=rid;
 FOR audit_society IN SELECT m."societyId" FROM portl_registry."Membership" m WHERE m."userId"=uid AND m.active AND m.role='ADMIN' LOOP
  INSERT INTO portl_registry."RegistryAudit" (id,"societyId","actorId",action,"resourceId","requestId","createdAt")
  VALUES (gen_random_uuid()::text,audit_society,uid,'OPERATOR_'||r.operation,uid,rid,clock_timestamp());
 END LOOP;
 RETURN 'COMPLETED';
END $$;
REVOKE ALL ON FUNCTION portl_auth.complete_admin_recovery(text,text,text,text,boolean,text) FROM PUBLIC;

