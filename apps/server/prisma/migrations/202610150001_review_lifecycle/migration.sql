-- Fail rather than adopting any pre-existing identity or invitation in the new reserved namespace.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM portl_auth."User" WHERE lower(email) LIKE '%@lifecycle.review.portl.invalid')
 OR EXISTS(SELECT 1 FROM portl_registry."Invitation" WHERE lower(email) LIKE '%@lifecycle.review.portl.invalid')
 THEN RAISE EXCEPTION 'Lifecycle review namespace already in use'; END IF;
END $$;
ALTER TABLE portl_auth."User" ADD COLUMN "isReviewLifecycle" boolean NOT NULL DEFAULT false;
CREATE TABLE portl_auth."ReviewLifecycle" (
 "userId" text PRIMARY KEY REFERENCES portl_auth."User"(id) ON DELETE CASCADE,
 "parentId" text NOT NULL,
 "parentSessionId" text NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 purpose text NOT NULL CHECK(purpose IN ('email-change','deletion')),
 "originalEmail" text NOT NULL UNIQUE,
 "nextEmail" text NOT NULL UNIQUE,
 "expiresAt" timestamp(3) NOT NULL,
 UNIQUE("parentSessionId",purpose),
 CHECK("originalEmail"="userId"||'.before@lifecycle.review.portl.invalid'),
 CHECK("nextEmail"="userId"||'.after@lifecycle.review.portl.invalid')
);
CREATE INDEX ON portl_auth."ReviewLifecycle"("parentId");
CREATE TABLE portl_auth."ReviewLifecycleCode" (
 "userId" text NOT NULL REFERENCES portl_auth."User"(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify-current-email','change-email','delete-account')),
 email text NOT NULL,
 "cipherText" text NOT NULL,
 "expiresAt" timestamp(3) NOT NULL,
 PRIMARY KEY("userId",purpose)
);
REVOKE ALL ON portl_auth."ReviewLifecycle",portl_auth."ReviewLifecycleCode" FROM PUBLIC;

CREATE FUNCTION portl_auth.lifecycle_parent_allowed(uid text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portl_auth."ReviewLifecycle" c
 JOIN portl_auth."ReviewerAccount" a ON a."userId"=c."parentId" AND a.generation=c.generation
 JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
 JOIN portl_auth."User" u ON u.id=a."userId" AND u."isReviewer" AND u."deletionRequestedAt" IS NULL
 JOIN portl_auth."Session" s ON s.id=c."parentSessionId" AND s."userId"=a."userId"
 JOIN portl_auth."ReviewerSession" marker ON marker."sessionId"=s.id AND marker."userId"=a."userId" AND marker.generation=a.generation
 WHERE c."userId"=uid AND c."expiresAt">clock_timestamp() AND s."expiresAt">clock_timestamp() AND a.enabled AND r.enabled)
$$;
CREATE OR REPLACE FUNCTION portl_auth.reviewer_session_allowed(uid text,sid text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portl_auth."User" u WHERE u.id=uid AND CASE
 WHEN u."isReviewLifecycle" THEN portl_auth.lifecycle_parent_allowed(uid)
 WHEN u."isReviewer" THEN EXISTS(
  SELECT 1 FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
  JOIN portl_auth."ReviewerSession" s ON s."userId"=a."userId" AND s.generation=a.generation
  WHERE a."userId"=uid AND s."sessionId"=sid AND a.enabled AND r.enabled)
 ELSE true END)
$$;
CREATE OR REPLACE FUNCTION portl_auth.reviewer_society_allowed(sid text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN u."isReviewLifecycle" THEN false WHEN u."isReviewer" THEN EXISTS(
  SELECT 1 FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
  WHERE a."userId"=u.id AND r."societyId"=sid AND a.enabled AND r.enabled)
 ELSE NOT EXISTS(SELECT 1 FROM portl_auth."ReviewRealm" r WHERE r."societyId"=sid) END
 FROM portl_auth."User" u WHERE u.id=portl_registry.actor()
$$;
CREATE OR REPLACE FUNCTION portl_auth.reviewer_target_allowed(sid text,email_address text,target_role text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN lower(email_address) LIKE '%@lifecycle.review.portl.invalid' THEN false
 WHEN EXISTS(SELECT 1 FROM portl_auth."ReviewRealm" WHERE "societyId"=sid) THEN EXISTS(
 SELECT 1 FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
 JOIN portl_auth."User" u ON u.id=a."userId" WHERE u.email=email_address AND u."isReviewer"
 AND r."societyId"=sid AND a.role::text=target_role AND a.enabled AND r.enabled)
 ELSE NOT EXISTS(SELECT 1 FROM portl_auth."User" WHERE email=email_address AND ("isReviewer" OR "isReviewLifecycle")) END
$$;
CREATE FUNCTION portl_auth.protect_lifecycle_identity() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."isReviewLifecycle" AND current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='portl_auth."User"'::regclass)
  THEN RAISE EXCEPTION 'Disposable erasure requires worker cleanup'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD."isReviewLifecycle" THEN
  -- Check inside the actual mutation transaction, even if the HTTP guard timed out.
  -- Parent operators never lock child User rows; owner erasure needs no live parent.
  IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='portl_auth."User"'::regclass) THEN
   PERFORM 1 FROM portl_auth."User" WHERE id=(SELECT "parentId" FROM portl_auth."ReviewLifecycle" WHERE "userId"=OLD.id) FOR SHARE;
   PERFORM 1 FROM portl_auth."Session" WHERE id=(SELECT "parentSessionId" FROM portl_auth."ReviewLifecycle" WHERE "userId"=OLD.id) FOR SHARE;
   IF NOT portl_auth.lifecycle_parent_allowed(OLD.id) THEN RAISE EXCEPTION 'Disposable parent access unavailable'; END IF;
  END IF;
  IF NOT NEW."isReviewLifecycle" OR NEW."isReviewer" OR NEW."twoFactorEnabled" OR NOT NEW."emailVerified"
   OR NOT EXISTS(SELECT 1 FROM portl_auth."ReviewLifecycle" c WHERE c."userId"=OLD.id AND NEW.email IN(c."originalEmail",c."nextEmail"))
  THEN RAISE EXCEPTION 'Immutable disposable review identity'; END IF;
 ELSIF NEW."isReviewLifecycle" THEN
  IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='portl_auth."User"'::regclass)
   OR TG_OP<>'INSERT' OR NEW."isReviewer" OR NEW."twoFactorEnabled" OR NOT NEW."emailVerified"
   OR NEW.email<>NEW.id||'.before@lifecycle.review.portl.invalid'
  THEN RAISE EXCEPTION 'Disposable review identity requires scoped provisioning'; END IF;
 ELSIF lower(NEW.email) LIKE '%@lifecycle.review.portl.invalid' THEN
  RAISE EXCEPTION 'Reserved disposable review email';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_identity BEFORE INSERT OR UPDATE OR DELETE ON portl_auth."User" FOR EACH ROW EXECUTE FUNCTION portl_auth.protect_lifecycle_identity();

CREATE FUNCTION portl_auth.allocate_review_lifecycle(parent_uid text,parent_sid text,kind text,cid text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE gen integer; existing text;
BEGIN
 IF kind NOT IN('email-change','deletion') OR cid::uuid IS NULL THEN RAISE EXCEPTION 'Invalid fixture'; END IF;
 -- Exclusive parent lock serializes allocations, key rotation and revocation.
 PERFORM 1 FROM portl_auth."User" WHERE id=parent_uid AND "isReviewer" AND "deletionRequestedAt" IS NULL FOR UPDATE;
 SELECT a.generation INTO gen FROM portl_auth."ReviewerAccount" a JOIN portl_auth."ReviewRealm" r ON r.id=a."realmId"
 JOIN portl_auth."Session" s ON s."userId"=a."userId" JOIN portl_auth."ReviewerSession" marker ON marker."sessionId"=s.id AND marker.generation=a.generation
 JOIN portl_auth."AccountPolicy" p ON p."userId"=a."userId"
 WHERE a."userId"=parent_uid AND s.id=parent_sid AND marker."userId"=parent_uid AND s."expiresAt">clock_timestamp() AND a.enabled AND r.enabled AND p.adult;
 IF gen IS NULL THEN RAISE EXCEPTION 'Current shared review session required'; END IF;
 SELECT "userId" INTO existing FROM portl_auth."ReviewLifecycle" WHERE "parentSessionId"=parent_sid AND purpose=kind;
 IF existing IS NOT NULL THEN
  IF portl_auth.lifecycle_parent_allowed(existing) AND EXISTS(SELECT 1 FROM portl_auth."User" WHERE id=existing AND "deletionRequestedAt" IS NULL AND email=existing||'.before@lifecycle.review.portl.invalid') THEN RETURN existing; END IF;
  RAISE EXCEPTION 'Start a new shared review session';
 END IF;
 IF (SELECT count(*) FROM portl_auth."ReviewLifecycle" WHERE "parentId"=parent_uid)>=6 THEN RAISE EXCEPTION 'Disposable fixture limit reached; wait for cleanup'; END IF;
 INSERT INTO portl_auth."User"(id,name,email,"emailVerified","updatedAt","isReviewLifecycle") VALUES(cid,'Disposable reviewer',cid||'.before@lifecycle.review.portl.invalid',true,now(),true);
 INSERT INTO portl_auth."ReviewLifecycle" VALUES(cid,parent_uid,parent_sid,gen,kind,cid||'.before@lifecycle.review.portl.invalid',cid||'.after@lifecycle.review.portl.invalid',now()+interval '1 hour');
 RETURN cid;
END $$;
-- Abandoned fixtures contain no society content. Submitted deletion jobs retain the normal ledger gate.
CREATE FUNCTION portl_auth.cleanup_review_lifecycle() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record;
BEGIN
 FOR c IN SELECT u.id AS "userId",u.id||'.before@lifecycle.review.portl.invalid' AS "originalEmail",u.id||'.after@lifecycle.review.portl.invalid' AS "nextEmail"
 FROM portl_auth."User" u LEFT JOIN portl_auth."ReviewLifecycle" l ON l."userId"=u.id
 WHERE u."isReviewLifecycle" AND u."deletionRequestedAt" IS NULL AND NOT portl_auth.lifecycle_parent_allowed(u.id)
 FOR UPDATE OF u SKIP LOCKED LOOP
  DELETE FROM portl_auth."Verification" WHERE identifier IN('email-verification-otp-'||c."originalEmail",'change-email-otp-'||c."originalEmail"||'-'||c."nextEmail");
  DELETE FROM portl_auth."User" WHERE id=c."userId" AND "isReviewLifecycle" AND "deletionRequestedAt" IS NULL;
 END LOOP;
 DELETE FROM portl_auth."ReviewLifecycleCode" WHERE "expiresAt"<now();
END $$;
REVOKE ALL ON FUNCTION portl_auth.lifecycle_parent_allowed(text),portl_auth.protect_lifecycle_identity(),portl_auth.allocate_review_lifecycle(text,text,text,text),portl_auth.cleanup_review_lifecycle() FROM PUBLIC;
