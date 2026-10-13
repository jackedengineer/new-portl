-- Replace the original SQL-only NO ACTION relationship with the canonical
-- Prisma-modeled cascading relationship added in the previous migration.
ALTER TABLE portl_registry."GuardAssignment" DROP CONSTRAINT guard_user;
