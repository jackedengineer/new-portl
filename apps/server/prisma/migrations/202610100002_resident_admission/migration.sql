-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "portl_registry";

-- CreateEnum
CREATE TYPE "portl_registry"."SocietyRole" AS ENUM ('RESIDENT', 'GUARD', 'ADMIN');

-- CreateEnum
CREATE TYPE "portl_registry"."ResidentRelationship" AS ENUM ('OWNER', 'TENANT');

-- CreateEnum
CREATE TYPE "portl_registry"."ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAssurance" (
    "sessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAssurance_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "AdminTotpUse" (
    "userId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminTotpUse_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "portl_registry"."Society" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joinCodeHash" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Society_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."Tower" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."Flat" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "towerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Flat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."Membership" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "portl_registry"."SocietyRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."Occupancy" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relationship" "portl_registry"."ResidentRelationship" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Occupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."Invitation" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "relationship" "portl_registry"."ResidentRelationship" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."ResidentApplication" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" "portl_registry"."ResidentRelationship" NOT NULL,
    "status" "portl_registry"."ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "ResidentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."RegistryAudit" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Society_joinCodeHash_key" ON "portl_registry"."Society"("joinCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Tower_societyId_id_key" ON "portl_registry"."Tower"("societyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Tower_societyId_name_key" ON "portl_registry"."Tower"("societyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Flat_societyId_id_key" ON "portl_registry"."Flat"("societyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Flat_societyId_towerId_label_key" ON "portl_registry"."Flat"("societyId", "towerId", "label");

-- CreateIndex
CREATE INDEX "Membership_userId_active_idx" ON "portl_registry"."Membership"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_societyId_userId_role_key" ON "portl_registry"."Membership"("societyId", "userId", "role");

-- CreateIndex
CREATE INDEX "Occupancy_userId_endedAt_idx" ON "portl_registry"."Occupancy"("userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Occupancy_societyId_flatId_userId_key" ON "portl_registry"."Occupancy"("societyId", "flatId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "portl_registry"."Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_societyId_createdAt_id_idx" ON "portl_registry"."Invitation"("societyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ResidentApplication_societyId_status_createdAt_id_idx" ON "portl_registry"."ResidentApplication"("societyId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ResidentApplication_userId_createdAt_id_idx" ON "portl_registry"."ResidentApplication"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "RegistryAudit_societyId_createdAt_idx" ON "portl_registry"."RegistryAudit"("societyId", "createdAt");

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAssurance" ADD CONSTRAINT "AdminAssurance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Tower" ADD CONSTRAINT "Tower_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Flat" ADD CONSTRAINT "Flat_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Flat" ADD CONSTRAINT "Flat_societyId_towerId_fkey" FOREIGN KEY ("societyId", "towerId") REFERENCES "portl_registry"."Tower"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Membership" ADD CONSTRAINT "Membership_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Occupancy" ADD CONSTRAINT "Occupancy_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Occupancy" ADD CONSTRAINT "Occupancy_societyId_flatId_fkey" FOREIGN KEY ("societyId", "flatId") REFERENCES "portl_registry"."Flat"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Occupancy" ADD CONSTRAINT "Occupancy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Invitation" ADD CONSTRAINT "Invitation_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."Invitation" ADD CONSTRAINT "Invitation_societyId_flatId_fkey" FOREIGN KEY ("societyId", "flatId") REFERENCES "portl_registry"."Flat"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."ResidentApplication" ADD CONSTRAINT "ResidentApplication_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."ResidentApplication" ADD CONSTRAINT "ResidentApplication_societyId_flatId_fkey" FOREIGN KEY ("societyId", "flatId") REFERENCES "portl_registry"."Flat"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."ResidentApplication" ADD CONSTRAINT "ResidentApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."RegistryAudit" ADD CONSTRAINT "RegistryAudit_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A pending request is unique even under concurrent submissions.
CREATE UNIQUE INDEX "ResidentApplication_one_pending" ON portl_registry."ResidentApplication" ("societyId", "userId") WHERE status = 'PENDING';

-- Context is transaction-local, supplied only after session verification at the API boundary.
CREATE FUNCTION portl_registry.actor() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT s."userId" FROM portl_auth."Session" s
    JOIN portl_auth."User" u ON u.id = s."userId"
    WHERE s.id = current_setting('portl.session_id', true)
      AND s."userId" = current_setting('portl.user_id', true)
      AND s."expiresAt" > now() AND u."emailVerified"), '')
$$;
CREATE FUNCTION portl_registry.scoped(sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT portl_registry.actor() <> '' AND sid = current_setting('portl.society_id', true)
$$;
CREATE FUNCTION portl_registry.is_admin(sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT portl_registry.scoped(sid)
    AND EXISTS (SELECT 1 FROM portl_registry."Membership" m WHERE m."societyId" = sid
      AND m."userId" = portl_registry.actor() AND m.role = 'ADMIN' AND m.active)
    AND EXISTS (SELECT 1 FROM portl_auth."AdminAssurance" a
      WHERE a."sessionId" = current_setting('portl.session_id', true) AND a."expiresAt" > now())
$$;
REVOKE ALL ON FUNCTION portl_registry.actor(), portl_registry.scoped(text), portl_registry.is_admin(text) FROM PUBLIC;

ALTER TABLE portl_registry."Society" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Society" FORCE ROW LEVEL SECURITY;
CREATE POLICY society_read ON portl_registry."Society" FOR SELECT USING (
  portl_registry.actor() <> '' AND (portl_registry.scoped(id) OR "joinCodeHash" = current_setting('portl.join_hash', true))
);
ALTER TABLE portl_registry."Tower" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Tower" FORCE ROW LEVEL SECURITY;
CREATE POLICY tower_read ON portl_registry."Tower" FOR SELECT USING (portl_registry.scoped("societyId"));
ALTER TABLE portl_registry."Flat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Flat" FORCE ROW LEVEL SECURITY;
CREATE POLICY flat_read ON portl_registry."Flat" FOR SELECT USING (portl_registry.scoped("societyId"));
ALTER TABLE portl_registry."Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON portl_registry."Membership" FOR SELECT USING (
  portl_registry.actor() <> '' AND ("userId" = portl_registry.actor() OR portl_registry.scoped("societyId"))
);
CREATE POLICY membership_insert ON portl_registry."Membership" FOR INSERT WITH CHECK (
  portl_registry.scoped("societyId") AND role = 'RESIDENT' AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
);
CREATE POLICY membership_update ON portl_registry."Membership" FOR UPDATE USING (
  portl_registry.scoped("societyId") AND role = 'RESIDENT' AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
) WITH CHECK (role = 'RESIDENT' AND portl_registry.scoped("societyId"));
ALTER TABLE portl_registry."Occupancy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Occupancy" FORCE ROW LEVEL SECURITY;
CREATE POLICY occupancy_read ON portl_registry."Occupancy" FOR SELECT USING (
  portl_registry.actor() <> '' AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
);
CREATE POLICY occupancy_insert ON portl_registry."Occupancy" FOR INSERT WITH CHECK (
  portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
);
CREATE POLICY occupancy_update ON portl_registry."Occupancy" FOR UPDATE USING (
  portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))
) WITH CHECK (portl_registry.scoped("societyId"));
ALTER TABLE portl_registry."Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_read ON portl_registry."Invitation" FOR SELECT USING (
  portl_registry.is_admin("societyId") OR (portl_registry.actor() <> ''
    AND email = current_setting('portl.email', true) AND "tokenHash" = current_setting('portl.invite_hash', true))
);
CREATE POLICY invitation_insert ON portl_registry."Invitation" FOR INSERT WITH CHECK (portl_registry.is_admin("societyId") AND "createdBy" = portl_registry.actor());
CREATE POLICY invitation_update ON portl_registry."Invitation" FOR UPDATE USING (
  portl_registry.is_admin("societyId") OR (portl_registry.scoped("societyId")
    AND email = current_setting('portl.email', true) AND "tokenHash" = current_setting('portl.invite_hash', true))
) WITH CHECK (portl_registry.scoped("societyId"));
ALTER TABLE portl_registry."ResidentApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."ResidentApplication" FORCE ROW LEVEL SECURITY;
CREATE POLICY application_read ON portl_registry."ResidentApplication" FOR SELECT USING (
  "userId" = portl_registry.actor() OR portl_registry.is_admin("societyId")
);
CREATE POLICY application_insert ON portl_registry."ResidentApplication" FOR INSERT WITH CHECK (
  portl_registry.scoped("societyId") AND "userId" = portl_registry.actor() AND status = 'PENDING'
);
CREATE POLICY application_update ON portl_registry."ResidentApplication" FOR UPDATE USING (
  portl_registry.is_admin("societyId") OR "userId" = portl_registry.actor()
) WITH CHECK (
  portl_registry.scoped("societyId") AND (portl_registry.is_admin("societyId") OR ("userId" = portl_registry.actor() AND status = 'WITHDRAWN'))
);
ALTER TABLE portl_registry."RegistryAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."RegistryAudit" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON portl_registry."RegistryAudit" FOR SELECT USING (portl_registry.is_admin("societyId"));
CREATE POLICY audit_insert ON portl_registry."RegistryAudit" FOR INSERT WITH CHECK (portl_registry.scoped("societyId") AND "actorId" = portl_registry.actor());
