-- Membership/occupancy predicates belong to the registry provider. Moving the
-- existing functions preserves dependent policy OIDs and their existing grants.
ALTER FUNCTION portl_community.is_resident(text) SET SCHEMA portl_registry;
ALTER FUNCTION portl_registry.is_resident(text) RENAME TO is_current_resident;
ALTER FUNCTION portl_community.active_admin(text) SET SCHEMA portl_registry;

-- Keep prior notice/notification SQL callers compatible, with one implementation.
CREATE FUNCTION portl_community.is_resident(sid text) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT portl_registry.is_current_resident(sid)
$$;
CREATE FUNCTION portl_community.active_admin(sid text) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT portl_registry.active_admin(sid)
$$;
REVOKE ALL ON FUNCTION portl_community.is_resident(text),portl_community.active_admin(text) FROM PUBLIC;
