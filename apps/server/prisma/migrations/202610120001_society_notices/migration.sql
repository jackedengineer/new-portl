CREATE SCHEMA portl_community;
CREATE TABLE portl_community."Notice" (
 id text PRIMARY KEY, "societyId" text NOT NULL REFERENCES portl_registry."Society"(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
 body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
 status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 version integer NOT NULL DEFAULT 1 CHECK (version>0), "createdBy" text NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
 "publishedAt" timestamp(3), "archivedAt" timestamp(3),
 CHECK ((status='DRAFT' AND "publishedAt" IS NULL AND "archivedAt" IS NULL)
 OR (status='PUBLISHED' AND "publishedAt" IS NOT NULL AND "archivedAt" IS NULL)
 OR (status='ARCHIVED' AND "archivedAt" IS NOT NULL))
);
CREATE INDEX notice_board ON portl_community."Notice" ("societyId",status,"createdAt" DESC,id DESC);
CREATE TABLE portl_community."NoticePublication" (
 "noticeId" text PRIMARY KEY REFERENCES portl_community."Notice"(id) ON DELETE CASCADE,
 "capturedAt" timestamp(3) NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['Notice','NoticePublication'] LOOP
 EXECUTE format('ALTER TABLE portl_community.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE portl_community.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY migration_owner ON portl_community.%I USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',t,'portl_community."'||t||'"','portl_community."'||t||'"');
END LOOP; END $$;
CREATE FUNCTION portl_community.is_resident(sid text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT portl_registry.scoped(sid)
 AND EXISTS (SELECT 1 FROM portl_registry."Society" s WHERE s.id=sid AND NOT s.archived)
 AND EXISTS (SELECT 1 FROM portl_registry."Membership" m WHERE m."societyId"=sid AND m."userId"=portl_registry.actor() AND m.role='RESIDENT' AND m.active)
 AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Flat" f ON f.id=o."flatId" AND f."societyId"=o."societyId" AND NOT f.archived
 WHERE o."societyId"=sid AND o."userId"=portl_registry.actor() AND o."endedAt" IS NULL)
$$;
CREATE FUNCTION portl_community.active_admin(sid text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT portl_registry.is_admin(sid) AND EXISTS (SELECT 1 FROM portl_registry."Society" s WHERE s.id=sid AND NOT s.archived)
$$;
REVOKE ALL ON FUNCTION portl_community.is_resident(text), portl_community.active_admin(text) FROM PUBLIC;
CREATE POLICY notice_read ON portl_community."Notice" FOR SELECT USING (
 portl_community.active_admin("societyId") OR (status='PUBLISHED' AND portl_community.is_resident("societyId"))
);
CREATE POLICY notice_create ON portl_community."Notice" FOR INSERT WITH CHECK (
 portl_community.active_admin("societyId") AND "createdBy"=portl_registry.actor() AND status='DRAFT' AND version=1
);
CREATE POLICY notice_update ON portl_community."Notice" FOR UPDATE USING (portl_community.active_admin("societyId")) WITH CHECK (portl_community.active_admin("societyId"));
CREATE FUNCTION portl_community.check_notice_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT portl_community.active_admin(OLD."societyId") OR NEW.id<>OLD.id OR NEW."societyId"<>OLD."societyId" OR NEW."createdBy"<>OLD."createdBy" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'Invalid notice command'; END IF;
 IF OLD.status='ARCHIVED' OR (OLD.status='PUBLISHED' AND (NEW.status<>'ARCHIVED' OR NEW.title<>OLD.title OR NEW.body<>OLD.body))
 OR (OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','PUBLISHED','ARCHIVED'))
 OR (NEW.status<>OLD.status AND (NEW.title<>OLD.title OR NEW.body<>OLD.body))
 THEN RAISE EXCEPTION 'Invalid notice transition'; END IF;
 IF OLD."publishedAt" IS DISTINCT FROM NEW."publishedAt" AND NOT (OLD.status='DRAFT' AND NEW.status='PUBLISHED') THEN RAISE EXCEPTION 'Immutable publication'; END IF;
 NEW."updatedAt":=now();
 IF NEW.status='PUBLISHED' THEN NEW."publishedAt":=now(); END IF;
 IF NEW.status='ARCHIVED' THEN NEW."archivedAt":=now(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notice_change BEFORE UPDATE ON portl_community."Notice" FOR EACH ROW EXECUTE FUNCTION portl_community.check_notice_change();
REVOKE ALL ON FUNCTION portl_community.check_notice_change() FROM PUBLIC;

ALTER TABLE portl_notifications."Notification" DROP CONSTRAINT "Notification_type_check", DROP CONSTRAINT "Notification_resourceKind_check", DROP CONSTRAINT "Notification_check";
ALTER TABLE portl_notifications."Notification" ADD CONSTRAINT "Notification_type_check" CHECK (type IN ('VISITOR_REQUESTED','VISITOR_APPROVED','VISITOR_REJECTED','VISITOR_ENTERED','VISITOR_EXITED','GUEST_ENTERED','GUEST_EXITED','NOTICE_PUBLISHED'));
ALTER TABLE portl_notifications."Notification" ADD CONSTRAINT "Notification_resourceKind_check" CHECK ("resourceKind" IN ('REQUEST','PASS','NOTICE'));
ALTER TABLE portl_notifications."Notification" ADD CONSTRAINT notification_context CHECK (
 ("resourceKind"='NOTICE' AND type='NOTICE_PUBLISHED' AND view='RESIDENT' AND "flatId" IS NULL AND "occupancyId" IS NULL AND "occupancyStartedAt" IS NULL AND "assignmentId" IS NULL AND "assignmentVersion" IS NULL AND "gateId" IS NULL)
 OR ("resourceKind" IN ('REQUEST','PASS') AND type<>'NOTICE_PUBLISHED' AND (
 (view='RESIDENT' AND "flatId" IS NOT NULL AND "occupancyId" IS NOT NULL AND "occupancyStartedAt" IS NOT NULL AND "assignmentId" IS NULL)
 OR (view='GUARD' AND "gateId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "assignmentVersion" IS NOT NULL AND "occupancyId" IS NULL)))
);

CREATE OR REPLACE FUNCTION portl_notifications.eligible(n portl_notifications."Notification") RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT n."userId"=portl_registry.actor() AND portl_registry.scoped(n."societyId")
 AND n."createdAt">now()-interval '30 days'
 AND EXISTS (SELECT 1 FROM portl_registry."Society" s WHERE s.id=n."societyId" AND NOT s.archived)
 AND EXISTS (SELECT 1 FROM portl_registry."Membership" m WHERE m.id=n."membershipId" AND m."societyId"=n."societyId" AND m."userId"=n."userId" AND m.role::text=n.view AND m.active AND m."grantVersion"=n."membershipVersion")
 AND ((n."resourceKind"='NOTICE' AND n.view='RESIDENT' AND portl_community.is_resident(n."societyId")
 AND EXISTS (SELECT 1 FROM portl_community."Notice" x WHERE x.id=n."resourceId" AND x."societyId"=n."societyId" AND x.status='PUBLISHED'))
 OR (n."resourceKind"<>'NOTICE' AND (
 (n.view='RESIDENT' AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Flat" f ON f.id=o."flatId" AND f."societyId"=o."societyId" AND NOT f.archived
 WHERE o.id=n."occupancyId" AND o."societyId"=n."societyId" AND o."userId"=n."userId" AND o."flatId"=n."flatId" AND o."endedAt" IS NULL AND o."startedAt"=n."occupancyStartedAt"))
 OR (n.view='GUARD' AND EXISTS (SELECT 1 FROM portl_registry."GuardAssignment" a JOIN portl_registry."Gate" g ON g.id=a."gateId" AND g."societyId"=a."societyId" AND g.active
 WHERE a.id=n."assignmentId" AND a."societyId"=n."societyId" AND a."gateId"=n."gateId" AND a."userId"=n."userId" AND a.active AND a."grantVersion"=n."assignmentVersion")))))
$$;

CREATE FUNCTION portl_community.notify_notice(nid text) RETURNS TABLE(id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n portl_community."Notice"; captured text; BEGIN
 SELECT * INTO n FROM portl_community."Notice" x WHERE x.id=nid FOR UPDATE;
 IF n.id IS NULL OR n.status<>'PUBLISHED' OR NOT portl_community.active_admin(n."societyId") THEN RAISE EXCEPTION 'Notice publication unavailable'; END IF;
 INSERT INTO portl_community."NoticePublication" ("noticeId") VALUES (nid) ON CONFLICT DO NOTHING RETURNING "noticeId" INTO captured;
 IF captured IS NULL THEN RETURN; END IF;
 RETURN QUERY INSERT INTO portl_notifications."Notification" (id,"societyId","userId",type,"resourceKind","resourceId",version,"membershipId","membershipVersion",view,"expiresAt")
 SELECT gen_random_uuid()::text,n."societyId",m."userId",'NOTICE_PUBLISHED','NOTICE',nid,n.version,m.id,m."grantVersion",'RESIDENT',now()+interval '24 hours'
 FROM portl_registry."Membership" m WHERE m."societyId"=n."societyId" AND m.role='RESIDENT' AND m.active
 AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Flat" f ON f.id=o."flatId" AND f."societyId"=o."societyId" AND NOT f.archived
 WHERE o."societyId"=m."societyId" AND o."userId"=m."userId" AND o."endedAt" IS NULL)
 ON CONFLICT DO NOTHING RETURNING "Notification".id;
END $$;
CREATE FUNCTION portl_community.suppress_notice_push() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='ARCHIVED' THEN UPDATE portl_notifications."Notification" SET "pushEligible"=false WHERE "societyId"=NEW."societyId" AND "resourceKind"='NOTICE' AND "resourceId"=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notice_archive AFTER UPDATE ON portl_community."Notice" FOR EACH ROW EXECUTE FUNCTION portl_community.suppress_notice_push();
REVOKE ALL ON FUNCTION portl_community.notify_notice(text),portl_community.suppress_notice_push() FROM PUBLIC;
