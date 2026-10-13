-- Completed subjects are already durable in the external ledger. Only claim a
-- bounded set of due work; ledger storage does not cap the retention population.
CREATE OR REPLACE FUNCTION portl_auth.account_deletion_ledger() RETURNS TABLE("subjectHash" text,"expiresAt" timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT "subjectHash", (clock_timestamp()+interval '90 days')::timestamptz
 FROM portl_auth."AccountDeletion" WHERE status='PENDING' AND "nextAttemptAt"<=now()
 ORDER BY "requestedAt" LIMIT 100
$$;
