-- Reviewer authority is operator-provisioned metadata, never Society.isDemo.
ALTER TABLE portl_auth."User" ADD COLUMN "isReviewer" boolean NOT NULL DEFAULT false;
CREATE TABLE portl_auth."ReviewRealm" (
 id text PRIMARY KEY DEFAULT 'play-review' CHECK (id='play-review'),
 "societyId" text NOT NULL UNIQUE REFERENCES portl_registry."Society"(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE portl_auth."ReviewerAccount" (
 "userId" text PRIMARY KEY REFERENCES portl_auth."User"(id) ON DELETE RESTRICT,
 "realmId" text NOT NULL REFERENCES portl_auth."ReviewRealm"(id) ON DELETE RESTRICT,
 role portl_registry."SocietyRole" NOT NULL,
 "keyHash" text NOT NULL CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
 generation integer NOT NULL DEFAULT 1 CHECK (generation>0),
 enabled boolean NOT NULL DEFAULT true,
 UNIQUE ("realmId",role)
);
CREATE TABLE portl_auth."ReviewerSession" (
 "sessionId" text PRIMARY KEY REFERENCES portl_auth."Session"(id) ON DELETE CASCADE,
 "userId" text NOT NULL REFERENCES portl_auth."ReviewerAccount"("userId") ON DELETE RESTRICT,
 generation integer NOT NULL CHECK (generation>0)
);
CREATE INDEX ON portl_auth."ReviewerSession"("userId");
REVOKE ALL ON portl_auth."ReviewRealm",portl_auth."ReviewerAccount",portl_auth."ReviewerSession" FROM PUBLIC;

CREATE FUNCTION portl_auth.reviewer_session_allowed(uid text,sid text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM portl_auth."User" u WHERE u.id=uid AND
 (NOT u."isReviewer" OR EXISTS (
  SELECT 1 FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
  JOIN portl_auth."ReviewerSession" s ON s."userId"=a."userId" AND s.generation=a.generation
  WHERE a."userId"=uid AND s."sessionId"=sid AND a.enabled AND r.enabled)))
$$;
CREATE OR REPLACE FUNCTION portl_registry.actor() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT s."userId" FROM portl_auth."Session" s JOIN portl_auth."User" u ON u.id=s."userId"
 WHERE s.id=current_setting('portl.session_id',true) AND s."userId"=current_setting('portl.user_id',true)
 AND s."expiresAt">now() AND u."emailVerified" AND portl_auth.reviewer_session_allowed(u.id,s.id)), '')
$$;
CREATE FUNCTION portl_auth.reviewer_society_allowed(sid text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN u."isReviewer" THEN EXISTS (
  SELECT 1 FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
  WHERE a."userId"=u.id AND r."societyId"=sid AND a.enabled AND r.enabled)
 ELSE NOT EXISTS (SELECT 1 FROM portl_auth."ReviewRealm" r WHERE r."societyId"=sid) END
 FROM portl_auth."User" u WHERE u.id=portl_registry.actor()
$$;
CREATE FUNCTION portl_auth.reviewer_target_allowed(sid text,email_address text,target_role text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS (SELECT 1 FROM portl_auth."ReviewRealm" WHERE "societyId"=sid) THEN EXISTS (
 SELECT 1 FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
 JOIN portl_auth."User" u ON u.id=a."userId" WHERE u.email=email_address AND u."isReviewer"
 AND r."societyId"=sid AND a.role::text=target_role AND a.enabled AND r.enabled)
 ELSE NOT EXISTS (SELECT 1 FROM portl_auth."User" WHERE email=email_address AND "isReviewer") END
$$;
REVOKE ALL ON FUNCTION portl_auth.reviewer_session_allowed(text,text),portl_auth.reviewer_society_allowed(text),portl_auth.reviewer_target_allowed(text,text,text) FROM PUBLIC;

-- A retired reviewer cannot become an ordinary principal by losing metadata.
CREATE FUNCTION portl_auth.protect_reviewer_identity() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."isReviewer" AND
 (NOT NEW."isReviewer" OR NEW.email<>OLD.email OR NOT NEW."emailVerified" OR NEW."twoFactorEnabled" OR NEW."deletionRequestedAt" IS NOT NULL)
 THEN RAISE EXCEPTION 'Shared review identity is operator managed'; END IF;
 IF NEW."isReviewer" AND (TG_OP='INSERT' OR NOT OLD."isReviewer") THEN
  IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='portl_auth."User"'::regclass)
   OR NEW.email NOT LIKE '%@review.portl.invalid' OR NOT NEW."emailVerified" OR NEW."twoFactorEnabled" OR NEW."deletionRequestedAt" IS NOT NULL
  THEN RAISE EXCEPTION 'Review identity requires owner provisioning'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewer_identity BEFORE INSERT OR UPDATE ON portl_auth."User" FOR EACH ROW EXECUTE FUNCTION portl_auth.protect_reviewer_identity();
CREATE FUNCTION portl_auth.protect_review_metadata() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='ReviewRealm' THEN
  IF NEW.id<>OLD.id OR NEW."societyId"<>OLD."societyId" THEN RAISE EXCEPTION 'Immutable review realm'; END IF;
 ELSE
  IF NOT EXISTS (SELECT 1 FROM portl_auth."User" WHERE id=NEW."userId" AND "isReviewer") THEN RAISE EXCEPTION 'Review principal required'; END IF;
  IF TG_OP='UPDATE' AND (NEW."userId"<>OLD."userId" OR NEW."realmId"<>OLD."realmId" OR NEW.role<>OLD.role OR NEW.generation<>OLD.generation+1)
   THEN RAISE EXCEPTION 'Immutable review role or invalid generation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_realm_identity BEFORE UPDATE ON portl_auth."ReviewRealm" FOR EACH ROW EXECUTE FUNCTION portl_auth.protect_review_metadata();
CREATE TRIGGER review_account_identity BEFORE INSERT OR UPDATE ON portl_auth."ReviewerAccount" FOR EACH ROW EXECUTE FUNCTION portl_auth.protect_review_metadata();
CREATE FUNCTION portl_auth.check_reviewer_session() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM portl_auth."Session" s JOIN portl_auth."ReviewerAccount" a ON a."userId"=s."userId"
 JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId" WHERE s.id=NEW."sessionId" AND s."userId"=NEW."userId"
 AND a.generation=NEW.generation AND a.enabled AND r.enabled AND s."expiresAt">clock_timestamp())
 THEN RAISE EXCEPTION 'Invalid review session generation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewer_session_generation BEFORE INSERT ON portl_auth."ReviewerSession" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_reviewer_session();

-- Restrictive policies augment existing role/occupancy authorization; they never grant it.
DO $$ DECLARE t record; col text; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('portl_registry','portl_gate','portl_notifications','portl_community') AND c.relkind='r' AND c.relrowsecurity
 AND (c.relname='Society' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='societyId' AND NOT a.attisdropped))
 LOOP
  col:=CASE WHEN t.nspname='portl_registry' AND t.relname='Society' THEN 'id' ELSE 'societyId' END;
  EXECUTE format('CREATE POLICY reviewer_fence ON %I.%I AS RESTRICTIVE FOR ALL USING (current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)) OR portl_auth.reviewer_society_allowed(%I)) WITH CHECK (current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)) OR portl_auth.reviewer_society_allowed(%I))',t.nspname,t.relname,format('%I.%I',t.nspname,t.relname),col,format('%I.%I',t.nspname,t.relname),col);
 END LOOP;
END $$;
CREATE FUNCTION portl_auth.check_review_grant() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text; expected_role text; email_address text;
BEGIN
 IF TG_TABLE_NAME='Invitation' THEN
  email_address:=NEW.email; expected_role:='RESIDENT';
 ELSE
  uid:=NEW."userId";
  SELECT email INTO email_address FROM portl_auth."User" WHERE id=uid;
  expected_role:=CASE WHEN TG_TABLE_NAME='Membership' THEN to_jsonb(NEW)->>'role' WHEN TG_TABLE_NAME='GuardAssignment' THEN 'GUARD' ELSE 'RESIDENT' END;
 END IF;
 IF NOT portl_auth.reviewer_target_allowed(NEW."societyId",email_address,expected_role)
 THEN RAISE EXCEPTION 'Review account role or society is unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_membership BEFORE INSERT OR UPDATE ON portl_registry."Membership" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_review_grant();
CREATE TRIGGER review_occupancy BEFORE INSERT OR UPDATE ON portl_registry."Occupancy" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_review_grant();
CREATE TRIGGER review_guard BEFORE INSERT OR UPDATE ON portl_registry."GuardAssignment" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_review_grant();
CREATE TRIGGER review_application BEFORE INSERT OR UPDATE ON portl_registry."ResidentApplication" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_review_grant();
CREATE TRIGGER review_invitation BEFORE INSERT OR UPDATE ON portl_registry."Invitation" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_review_grant();
REVOKE ALL ON FUNCTION portl_auth.protect_reviewer_identity(),portl_auth.protect_review_metadata(),portl_auth.check_reviewer_session(),portl_auth.check_review_grant() FROM PUBLIC;
