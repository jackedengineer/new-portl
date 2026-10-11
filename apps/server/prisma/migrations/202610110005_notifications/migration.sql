CREATE SCHEMA portl_notifications;
-- Capture the lifetime of a grant, so revoke/regrant does not restore old inbox access.
ALTER TABLE portl_registry."Membership" ADD COLUMN "grantVersion" integer NOT NULL DEFAULT 1;
ALTER TABLE portl_registry."GuardAssignment" ADD COLUMN "grantVersion" integer NOT NULL DEFAULT 1;
CREATE FUNCTION portl_registry.advance_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."grantVersion" := OLD."grantVersion" + CASE WHEN NEW.active IS DISTINCT FROM OLD.active THEN 1 ELSE 0 END; RETURN NEW; END $$;
CREATE TRIGGER membership_grant BEFORE UPDATE ON portl_registry."Membership" FOR EACH ROW EXECUTE FUNCTION portl_registry.advance_grant();
CREATE TRIGGER assignment_grant BEFORE UPDATE ON portl_registry."GuardAssignment" FOR EACH ROW EXECUTE FUNCTION portl_registry.advance_grant();
REVOKE ALL ON FUNCTION portl_registry.advance_grant() FROM PUBLIC;

CREATE TABLE portl_notifications."Notification" (
 id text PRIMARY KEY, "societyId" text NOT NULL REFERENCES portl_registry."Society"(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES portl_auth."User"(id) ON DELETE CASCADE,
 type text NOT NULL CHECK (type IN ('VISITOR_REQUESTED','VISITOR_APPROVED','VISITOR_REJECTED','VISITOR_ENTERED','VISITOR_EXITED','GUEST_ENTERED','GUEST_EXITED')),
 "resourceKind" text NOT NULL CHECK ("resourceKind" IN ('REQUEST','PASS')), "resourceId" text NOT NULL, version integer NOT NULL CHECK (version>0),
 "membershipId" text NOT NULL, "membershipVersion" integer NOT NULL, view text NOT NULL CHECK (view IN ('RESIDENT','GUARD')),
 "flatId" text, "occupancyId" text, "occupancyStartedAt" timestamp(3), "assignmentId" text, "assignmentVersion" integer, "gateId" text,
 "createdAt" timestamp(3) NOT NULL DEFAULT now(), "readAt" timestamp(3), "expiresAt" timestamp(3) NOT NULL,
 "pushEligible" boolean NOT NULL DEFAULT true,
 CHECK ((view='RESIDENT' AND "flatId" IS NOT NULL AND "occupancyId" IS NOT NULL AND "occupancyStartedAt" IS NOT NULL AND "assignmentId" IS NULL)
 OR (view='GUARD' AND "gateId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "assignmentVersion" IS NOT NULL AND "occupancyId" IS NULL)),
 UNIQUE ("societyId","userId",type,"resourceId",version)
);
CREATE INDEX notification_inbox ON portl_notifications."Notification" ("userId","createdAt" DESC,id DESC);
CREATE TABLE portl_notifications."PushDevice" (
 id text PRIMARY KEY, "userId" text NOT NULL, "sessionId" text NOT NULL, generation text NOT NULL,
 platform text NOT NULL CHECK (platform IN ('android','ios')), "tokenHash" text NOT NULL UNIQUE, "cipherText" text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX device_user ON portl_notifications."PushDevice" ("userId");
CREATE TABLE portl_notifications."Delivery" (
 id text PRIMARY KEY, "notificationId" text NOT NULL REFERENCES portl_notifications."Notification"(id) ON DELETE CASCADE,
 "deviceId" text NOT NULL, generation text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','RECEIPT_OK','FAILED','SKIPPED')),
 "ticketId" text, "errorCode" text, "createdAt" timestamp(3) NOT NULL DEFAULT now(),
 UNIQUE ("notificationId","deviceId",generation)
);
-- The migration owner is trusted to define these narrowly checked RPCs. API logins never own tables.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['Notification','PushDevice','Delivery'] LOOP
 EXECUTE format('ALTER TABLE portl_notifications.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE portl_notifications.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY migration_owner ON portl_notifications.%I USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',t,'portl_notifications."'||t||'"','portl_notifications."'||t||'"');
END LOOP; END $$;
-- A resident's decision needs to fan out to the gate assignments. Only the trusted RPC owner sees these rows.
CREATE POLICY assignment_notification_owner ON portl_registry."GuardAssignment" FOR SELECT USING (current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='portl_registry."GuardAssignment"'::regclass)));
CREATE FUNCTION portl_notifications.eligible(n portl_notifications."Notification") RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT n."userId"=portl_registry.actor() AND portl_registry.scoped(n."societyId")
 AND n."createdAt">now()-interval '30 days'
 AND EXISTS (SELECT 1 FROM portl_registry."Society" s WHERE s.id=n."societyId" AND NOT s.archived)
 AND EXISTS (SELECT 1 FROM portl_registry."Membership" m WHERE m.id=n."membershipId" AND m."societyId"=n."societyId" AND m."userId"=n."userId" AND m.role::text=n.view AND m.active AND m."grantVersion"=n."membershipVersion")
 AND ((n.view='RESIDENT' AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Flat" f ON f.id=o."flatId" AND f."societyId"=o."societyId" AND NOT f.archived
 WHERE o.id=n."occupancyId" AND o."societyId"=n."societyId" AND o."userId"=n."userId" AND o."flatId"=n."flatId" AND o."endedAt" IS NULL AND o."startedAt"=n."occupancyStartedAt"))
 OR (n.view='GUARD' AND EXISTS (SELECT 1 FROM portl_registry."GuardAssignment" a JOIN portl_registry."Gate" g ON g.id=a."gateId" AND g."societyId"=a."societyId" AND g.active
 WHERE a.id=n."assignmentId" AND a."societyId"=n."societyId" AND a."gateId"=n."gateId" AND a."userId"=n."userId" AND a.active AND a."grantVersion"=n."assignmentVersion")))
$$;
CREATE POLICY inbox_read ON portl_notifications."Notification" FOR SELECT USING (portl_notifications.eligible("Notification"));
CREATE POLICY inbox_read_at ON portl_notifications."Notification" FOR UPDATE USING (portl_notifications.eligible("Notification")) WITH CHECK (portl_notifications.eligible("Notification"));
REVOKE ALL ON FUNCTION portl_notifications.eligible(portl_notifications."Notification") FROM PUBLIC;

-- Gate module producer: derives event and recipients from the authoritative, locked resource.
CREATE FUNCTION portl_gate.notify_request(rid text) RETURNS TABLE(id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r portl_gate."VisitorRequest"; v portl_gate."Visit"; kind text; deadline timestamp(3); BEGIN
 SELECT * INTO r FROM portl_gate."VisitorRequest" WHERE "VisitorRequest".id=rid;
 IF r.id IS NULL OR NOT portl_registry.scoped(r."societyId") OR NOT (portl_gate.is_guard(r."societyId") OR portl_gate.is_recipient(r."societyId",rid,portl_registry.actor())) THEN RAISE EXCEPTION 'Gate event unavailable'; END IF;
 UPDATE portl_notifications."Notification" n SET "pushEligible"=false WHERE n."societyId"=r."societyId" AND n."resourceId"=rid AND n.version<r.version;
 SELECT * INTO v FROM portl_gate."Visit" WHERE "requestId"=rid;
 deadline := now()+interval '24 hours';
 IF v.id IS NOT NULL THEN kind:=CASE WHEN v."exitedAt" IS NULL THEN 'VISITOR_ENTERED' ELSE 'VISITOR_EXITED' END;
 ELSIF r.status='PENDING' THEN kind:='VISITOR_REQUESTED'; deadline:=r."expiresAt";
 ELSIF r.status='APPROVED' THEN kind:='VISITOR_APPROVED'; deadline:=r."approvedUntil";
 ELSIF r.status='REJECTED' THEN kind:='VISITOR_REJECTED'; ELSE RETURN; END IF;
 IF kind IN ('VISITOR_APPROVED','VISITOR_REJECTED') THEN
 RETURN QUERY INSERT INTO portl_notifications."Notification" (id,"societyId","userId",type,"resourceKind","resourceId",version,"membershipId","membershipVersion",view,"assignmentId","assignmentVersion","gateId","expiresAt")
 SELECT gen_random_uuid()::text,r."societyId",a."userId",kind,'REQUEST',rid,r.version,m.id,m."grantVersion",'GUARD',a.id,a."grantVersion",a."gateId",deadline
 FROM portl_registry."GuardAssignment" a JOIN portl_registry."Membership" m ON m."societyId"=a."societyId" AND m."userId"=a."userId" AND m.role='GUARD' AND m.active
 JOIN portl_registry."Gate" g ON g.id=a."gateId" AND g."societyId"=a."societyId" AND g.active
 WHERE a."societyId"=r."societyId" AND a."gateId"=r."gateId" AND a.active ON CONFLICT DO NOTHING RETURNING "Notification".id;
 ELSE
 RETURN QUERY INSERT INTO portl_notifications."Notification" (id,"societyId","userId",type,"resourceKind","resourceId",version,"membershipId","membershipVersion",view,"flatId","occupancyId","occupancyStartedAt","expiresAt")
 SELECT gen_random_uuid()::text,r."societyId",rr."userId",kind,'REQUEST',rid,r.version,m.id,m."grantVersion",'RESIDENT',r."flatId",o.id,o."startedAt",deadline
 FROM portl_gate."RequestRecipient" rr JOIN portl_registry."Occupancy" o ON o.id=rr."occupancyId" AND o."societyId"=rr."societyId" AND o."userId"=rr."userId" AND o."flatId"=r."flatId" AND o."startedAt"=rr."occupancyStartedAt" AND o."endedAt" IS NULL
 JOIN portl_registry."Membership" m ON m."societyId"=rr."societyId" AND m."userId"=rr."userId" AND m.role='RESIDENT' AND m.active
 WHERE rr."requestId"=rid AND rr."societyId"=r."societyId" ON CONFLICT DO NOTHING RETURNING "Notification".id;
 END IF; END $$;
CREATE FUNCTION portl_gate.notify_pass(pid text) RETURNS TABLE(id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p portl_gate."GuestPass"; v portl_gate."Visit"; kind text; BEGIN
 SELECT * INTO p FROM portl_gate."GuestPass" WHERE "GuestPass".id=pid;
 IF p.id IS NULL OR NOT portl_registry.scoped(p."societyId") OR NOT portl_gate.is_guard(p."societyId") THEN RAISE EXCEPTION 'Gate event unavailable'; END IF;
 SELECT * INTO v FROM portl_gate."Visit" WHERE "passId"=pid;
 IF v.id IS NULL THEN RETURN; END IF;
 kind:=CASE WHEN v."exitedAt" IS NULL THEN 'GUEST_ENTERED' ELSE 'GUEST_EXITED' END;
 UPDATE portl_notifications."Notification" n SET "pushEligible"=false WHERE n."societyId"=p."societyId" AND n."resourceId"=pid AND n.version<p.version;
 RETURN QUERY INSERT INTO portl_notifications."Notification" (id,"societyId","userId",type,"resourceKind","resourceId",version,"membershipId","membershipVersion",view,"flatId","occupancyId","occupancyStartedAt","expiresAt")
 SELECT gen_random_uuid()::text,p."societyId",p."issuerId",kind,'PASS',pid,p.version,m.id,m."grantVersion",'RESIDENT',p."flatId",o.id,o."startedAt",now()+interval '24 hours'
 FROM portl_registry."Occupancy" o JOIN portl_registry."Membership" m ON m."societyId"=o."societyId" AND m."userId"=o."userId" AND m.role='RESIDENT' AND m.active
 WHERE o.id=p."occupancyId" AND o."societyId"=p."societyId" AND o."userId"=p."issuerId" AND o."flatId"=p."flatId" AND o."endedAt" IS NULL AND o."startedAt"=p."occupancyStartedAt" ON CONFLICT DO NOTHING RETURNING "Notification".id;
END $$;
REVOKE ALL ON FUNCTION portl_gate.notify_request(text),portl_gate.notify_pass(text) FROM PUBLIC;

CREATE FUNCTION portl_notifications.register_device(i text, token_hash text, encrypted text, gen text, os text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text:=portl_registry.actor(); prior portl_notifications."PushDevice"; BEGIN
 IF uid='' OR length(i)<>36 OR length(gen)<>36 OR length(token_hash)<>64 OR length(encrypted)>1000 OR os NOT IN ('android','ios') THEN RAISE EXCEPTION 'Invalid registration'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('device-user:'||uid,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('device:'||i,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('token:'||token_hash,0));
 SELECT * INTO prior FROM portl_notifications."PushDevice" WHERE id=i FOR UPDATE;
 IF prior.id IS NOT NULL AND prior."userId"<>uid AND prior.enabled AND EXISTS (SELECT 1 FROM portl_auth."Session" s WHERE s.id=prior."sessionId" AND s."userId"=prior."userId" AND s."expiresAt">now()) THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM portl_notifications."PushDevice" WHERE "tokenHash"=token_hash AND id<>i) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM portl_notifications."PushDevice" WHERE "userId"=uid AND id<>i AND enabled AND "updatedAt">now()-interval '30 days')>=5 THEN RETURN false; END IF;
 IF prior.id IS NOT NULL AND prior."userId"=uid AND prior."sessionId"=current_setting('portl.session_id',true) AND prior."tokenHash"=token_hash AND prior.enabled THEN UPDATE portl_notifications."PushDevice" SET "updatedAt"=now() WHERE id=i; RETURN true; END IF;
 INSERT INTO portl_notifications."PushDevice" (id,"userId","sessionId",generation,platform,"tokenHash","cipherText") VALUES (i,uid,current_setting('portl.session_id',true),gen,os,token_hash,encrypted)
 ON CONFLICT (id) DO UPDATE SET "userId"=EXCLUDED."userId","sessionId"=EXCLUDED."sessionId",generation=EXCLUDED.generation,platform=EXCLUDED.platform,"tokenHash"=EXCLUDED."tokenHash","cipherText"=EXCLUDED."cipherText",enabled=true,"updatedAt"=now();
 RETURN true; END $$;
CREATE FUNCTION portl_notifications.remove_device(i text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE portl_notifications."PushDevice" SET enabled=false WHERE id=i AND "userId"=portl_registry.actor() AND "sessionId"=current_setting('portl.session_id',true)
$$;
REVOKE ALL ON FUNCTION portl_notifications.register_device(text,text,text,text,text),portl_notifications.remove_device(text) FROM PUBLIC;

-- Worker targeting is the only read path to encrypted tokens. It reuses verified, live device sessions and normal tenant authorization.
CREATE FUNCTION portl_notifications.delivery_targets(nid text) RETURNS TABLE("deviceId" text,generation text,"cipherText" text,type text,"expiresAt" timestamp(3)) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n portl_notifications."Notification"; d portl_notifications."PushDevice"; BEGIN
 SELECT x.* INTO n FROM portl_notifications."Notification" x WHERE x.id=nid AND x."pushEligible" AND x."expiresAt">now();
 IF n.id IS NULL THEN RETURN; END IF;
 FOR d IN SELECT * FROM portl_notifications."PushDevice" WHERE "userId"=n."userId" AND enabled AND "updatedAt">now()-interval '30 days' LOOP
 PERFORM set_config('portl.user_id',n."userId",true),set_config('portl.session_id',d."sessionId",true),set_config('portl.society_id',n."societyId",true);
 IF portl_notifications.eligible(n) THEN
 "deviceId":=d.id; generation:=d.generation; "cipherText":=d."cipherText"; type:=n.type; "expiresAt":=n."expiresAt"; RETURN NEXT;
 END IF; END LOOP; END $$;
CREATE FUNCTION portl_notifications.retire_device(i text,gen text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE portl_notifications."PushDevice" SET enabled=false WHERE id=i AND generation=gen
$$;
REVOKE ALL ON FUNCTION portl_notifications.delivery_targets(text),portl_notifications.retire_device(text,text) FROM PUBLIC;
CREATE FUNCTION portl_notifications.cleanup() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE deleted integer; BEGIN
 DELETE FROM portl_notifications."Notification" WHERE id IN (SELECT id FROM portl_notifications."Notification" WHERE "createdAt"<now()-interval '30 days' LIMIT 1000);
 GET DIAGNOSTICS deleted = ROW_COUNT;
 DELETE FROM portl_notifications."PushDevice" WHERE id IN (SELECT id FROM portl_notifications."PushDevice" WHERE "updatedAt"<now()-interval '30 days' LIMIT 1000);
 UPDATE portl_notifications."Delivery" SET status='FAILED',"errorCode"='DELIVERY_TIMEOUT' WHERE "createdAt"<now()-interval '24 hours' AND status IN ('PENDING','ACCEPTED');
 DELETE FROM portl_notifications."Delivery" WHERE "createdAt"<now()-interval '7 days';
 RETURN deleted; END $$;
REVOKE ALL ON FUNCTION portl_notifications.cleanup() FROM PUBLIC;
