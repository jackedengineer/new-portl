-- Serialize session issuance with deletion's User row lock, including requests
-- that authenticated before deletion was confirmed.
CREATE FUNCTION portl_auth.check_account_session() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM portl_auth."User" WHERE id=NEW."userId" AND "deletionRequestedAt" IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_session_guard BEFORE INSERT OR UPDATE ON portl_auth."Session" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_account_session();
CREATE FUNCTION portl_auth.check_account_creation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM portl_auth."AccountDeletion" WHERE "emailHash"=encode(sha256(convert_to('deleted-email:'||NEW.email,'UTF8')),'hex') AND (status='PENDING' OR "completedAt">now()-interval '10 minutes')) THEN RAISE EXCEPTION 'Account unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_creation_guard BEFORE INSERT OR UPDATE OF email ON portl_auth."User" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_account_creation();

CREATE FUNCTION portl_auth.revoke_session_devices(uid text, sid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM portl_auth."Session" WHERE id=current_setting('portl.session_id',true) AND "userId"=uid AND "expiresAt">clock_timestamp()) THEN RAISE EXCEPTION 'Account authorization required'; END IF;
 DELETE FROM portl_notifications."Delivery" WHERE "deviceId" IN (SELECT id FROM portl_notifications."PushDevice" WHERE "userId"=uid AND "sessionId"=sid);
 DELETE FROM portl_notifications."PushDevice" WHERE "userId"=uid AND "sessionId"=sid;
END $$;
REVOKE ALL ON FUNCTION portl_auth.revoke_session_devices(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION portl_auth.cleanup_account_metadata() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM portl_auth."DeletionChallenge" WHERE "expiresAt"<now();
 DELETE FROM portl_auth."Verification" WHERE "expiresAt"<now();
 DELETE FROM portl_auth."OtpThrottle" WHERE "resetAt"<now();
 DELETE FROM portl_auth."Session" WHERE "expiresAt"<now();
 UPDATE portl_auth."AccountDeletion" SET "emailHash"=NULL WHERE status='COMPLETED' AND "completedAt"<now()-interval '10 minutes' AND "emailHash" IS NOT NULL;
 DELETE FROM portl_auth."AccountDeletion" WHERE status='COMPLETED' AND "completedAt"<now()-interval '90 days';
END $$;
