ALTER TABLE portl_registry."Tower" ADD COLUMN archived boolean NOT NULL DEFAULT false,
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version>0);
ALTER TABLE portl_registry."Flat" ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version>0);
CREATE UNIQUE INDEX tower_name_normalized ON portl_registry."Tower" ("societyId", lower(btrim(name)));
CREATE UNIQUE INDEX flat_label_normalized ON portl_registry."Flat" ("societyId", "towerId", lower(btrim(label)));

CREATE POLICY tower_create ON portl_registry."Tower" FOR INSERT WITH CHECK (portl_community.active_admin("societyId"));
CREATE POLICY tower_update ON portl_registry."Tower" FOR UPDATE USING (portl_registry.scoped("societyId")) WITH CHECK (portl_community.active_admin("societyId"));
CREATE POLICY flat_create ON portl_registry."Flat" FOR INSERT WITH CHECK (portl_community.active_admin("societyId"));
CREATE POLICY flat_update ON portl_registry."Flat" FOR UPDATE USING (portl_registry.scoped("societyId")) WITH CHECK (portl_community.active_admin("societyId"));

-- Parent locks serialize new admission/structure writes against archive commands.
CREATE FUNCTION portl_registry.check_flat_tower() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM id FROM portl_registry."Tower" WHERE id=NEW."towerId" AND "societyId"=NEW."societyId" AND NOT archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tower unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER flat_tower_active BEFORE INSERT ON portl_registry."Flat" FOR EACH ROW EXECUTE FUNCTION portl_registry.check_flat_tower();
CREATE FUNCTION portl_registry.check_admission_flat() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='Occupancy' THEN
  IF NEW."endedAt" IS NOT NULL THEN RETURN NEW; END IF;
 END IF;
 PERFORM id FROM portl_registry."Flat" WHERE id=NEW."flatId" AND "societyId"=NEW."societyId" AND NOT archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Flat unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER occupancy_flat_active BEFORE INSERT OR UPDATE OF "endedAt" ON portl_registry."Occupancy" FOR EACH ROW EXECUTE FUNCTION portl_registry.check_admission_flat();
CREATE TRIGGER invitation_flat_active BEFORE INSERT ON portl_registry."Invitation" FOR EACH ROW EXECUTE FUNCTION portl_registry.check_admission_flat();
CREATE TRIGGER application_flat_active BEFORE INSERT ON portl_registry."ResidentApplication" FOR EACH ROW EXECUTE FUNCTION portl_registry.check_admission_flat();
REVOKE ALL ON FUNCTION portl_registry.check_flat_tower(),portl_registry.check_admission_flat() FROM PUBLIC;

CREATE TABLE portl_registry."DirectoryEntry" (
 id text PRIMARY KEY, "societyId" text NOT NULL REFERENCES portl_registry."Society"(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 kind text NOT NULL CHECK (kind IN ('STAFF','SERVICE_PROVIDER')),
 service text NOT NULL CHECK (length(btrim(service)) BETWEEN 1 AND 80),
 description text NOT NULL DEFAULT '' CHECK (length(description)<=500),
 archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK (version>0),
 UNIQUE ("societyId",id)
);
CREATE INDEX directory_page ON portl_registry."DirectoryEntry" ("societyId",archived,id);
CREATE TABLE portl_registry."DirectoryContact" (
 "entryId" text PRIMARY KEY, "societyId" text NOT NULL,
 phone text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
 "sharePhone" boolean NOT NULL DEFAULT false,
 FOREIGN KEY ("societyId","entryId") REFERENCES portl_registry."DirectoryEntry"("societyId",id) ON DELETE CASCADE,
 CHECK (NOT "sharePhone" OR phone IS NOT NULL), UNIQUE ("societyId","entryId")
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['DirectoryEntry','DirectoryContact'] LOOP
 EXECUTE format('ALTER TABLE portl_registry.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE portl_registry.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY migration_owner ON portl_registry.%I USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',t,'portl_registry."'||t||'"','portl_registry."'||t||'"');
 EXECUTE format('CREATE POLICY directory_create ON portl_registry.%I FOR INSERT WITH CHECK (portl_community.active_admin("societyId"))',t);
 EXECUTE format('CREATE POLICY directory_update ON portl_registry.%I FOR UPDATE USING (portl_community.active_admin("societyId")) WITH CHECK (portl_community.active_admin("societyId"))',t);
END LOOP; END $$;
CREATE POLICY directory_read ON portl_registry."DirectoryEntry" FOR SELECT USING (
 portl_community.active_admin("societyId") OR (NOT archived AND portl_community.is_resident("societyId"))
);
CREATE POLICY contact_read ON portl_registry."DirectoryContact" FOR SELECT USING (
 portl_community.active_admin("societyId") OR ("sharePhone" AND portl_community.is_resident("societyId")
 AND EXISTS (SELECT 1 FROM portl_registry."DirectoryEntry" e WHERE e.id="entryId" AND e."societyId"="DirectoryContact"."societyId" AND NOT e.archived))
);
