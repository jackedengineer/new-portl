-- Email ownership changes and credential revocation are one database commit.
CREATE FUNCTION portl_auth.email_change_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.email IS NOT DISTINCT FROM OLD.email THEN RETURN NEW; END IF;
 IF OLD."deletionRequestedAt" IS NOT NULL THEN RAISE EXCEPTION 'Account unavailable'; END IF;
 DELETE FROM portl_notifications."Delivery" WHERE "deviceId" IN (SELECT id FROM portl_notifications."PushDevice" WHERE "userId"=OLD.id);
 DELETE FROM portl_notifications."PushDevice" WHERE "userId"=OLD.id;
 DELETE FROM portl_auth."Session" WHERE "userId"=OLD.id;
 DELETE FROM portl_auth."DeletionChallenge" WHERE "userId"=OLD.id;
 DELETE FROM portl_registry."Invitation" WHERE email=OLD.email AND "acceptedAt" IS NULL;
 DELETE FROM portl_auth."Verification" WHERE identifier IN ('sign-in-otp-'||OLD.email,'sign-in-otp-'||NEW.email,'email-verification-otp-'||OLD.email)
 OR identifier LIKE 'change-email-otp-'||replace(replace(replace(OLD.email,'\','\\'),'%','\%'),'_','\_')||'-%';
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION portl_auth.email_change_cleanup() FROM PUBLIC;
CREATE TRIGGER email_change_cleanup AFTER UPDATE OF email ON portl_auth."User" FOR EACH ROW EXECUTE FUNCTION portl_auth.email_change_cleanup();
