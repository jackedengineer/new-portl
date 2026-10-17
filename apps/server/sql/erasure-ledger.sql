-- Run with owner credentials in a dedicated independent Neon project, never the
-- business project. Grant the worker EXECUTE on the two RPCs only after review.
CREATE SCHEMA IF NOT EXISTS portl_erasure_ledger;
REVOKE ALL ON SCHEMA portl_erasure_ledger FROM PUBLIC;
CREATE TABLE IF NOT EXISTS portl_erasure_ledger.tombstone (
  subject_hash text PRIMARY KEY CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON portl_erasure_ledger.tombstone FROM PUBLIC;

CREATE OR REPLACE FUNCTION portl_erasure_ledger.persist(entries jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e jsonb; expiry timestamptz; persisted integer:=0;
BEGIN
 IF jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries)>100 THEN RAISE EXCEPTION 'Invalid ledger batch'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(entries) LOOP
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid ledger record'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(e))<>2
    OR jsonb_typeof(e->'subjectHash') IS DISTINCT FROM 'string'
    OR coalesce(e->>'subjectHash','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(e->'expiresAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid ledger record'; END IF;
  expiry:=(e->>'expiresAt')::timestamptz;
  IF NOT isfinite(expiry) OR expiry>clock_timestamp()+interval '91 days' THEN RAISE EXCEPTION 'Invalid ledger expiry'; END IF;
  IF expiry<=clock_timestamp() THEN CONTINUE; END IF;
  INSERT INTO portl_erasure_ledger.tombstone (subject_hash,expires_at) VALUES (e->>'subjectHash',expiry)
    ON CONFLICT (subject_hash) DO UPDATE SET expires_at=greatest(portl_erasure_ledger.tombstone.expires_at,excluded.expires_at);
  persisted:=persisted+1;
 END LOOP;
 RETURN persisted;
END $$;
CREATE OR REPLACE FUNCTION portl_erasure_ledger.cleanup() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM portl_erasure_ledger.tombstone WHERE subject_hash IN
   (SELECT subject_hash FROM portl_erasure_ledger.tombstone WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 1000)
   AND expires_at<=clock_timestamp();
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION portl_erasure_ledger.persist(jsonb),portl_erasure_ledger.cleanup() FROM PUBLIC;
