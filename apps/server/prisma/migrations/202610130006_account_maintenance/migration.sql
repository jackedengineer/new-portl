CREATE FUNCTION portl_auth.account_deletion_ledger() RETURNS TABLE("subjectHash" text,"expiresAt" timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT "subjectHash", (coalesce("completedAt",clock_timestamp())+interval '90 days')::timestamptz FROM portl_auth."AccountDeletion" WHERE status='PENDING' OR "completedAt">now()-interval '90 days' ORDER BY "requestedAt" LIMIT 5001
$$;
REVOKE ALL ON FUNCTION portl_auth.account_deletion_ledger() FROM PUBLIC;
CREATE OR REPLACE FUNCTION portl_auth.cleanup_account_metadata() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM portl_auth."DeletionChallenge" WHERE "expiresAt"<now();
 DELETE FROM portl_auth."Verification" WHERE "expiresAt"<now();
 DELETE FROM portl_auth."OtpThrottle" WHERE "resetAt"<now();
 DELETE FROM portl_auth."Session" WHERE "expiresAt"<now();
 -- Better Auth 1.7.7 stores lastRequest as Unix milliseconds. Retain expired
 -- IP rate buckets for at most 24h plus one hourly maintenance interval.
 DELETE FROM portl_auth."RateLimit" WHERE "lastRequest" < (extract(epoch from now()-interval '24 hours')*1000)::bigint;
 UPDATE portl_auth."AccountDeletion" SET "emailHash"=NULL WHERE status='COMPLETED' AND "completedAt"<now()-interval '10 minutes' AND "emailHash" IS NOT NULL;
 DELETE FROM portl_auth."AccountDeletion" WHERE status='COMPLETED' AND "completedAt"<now()-interval '90 days';
END $$;
