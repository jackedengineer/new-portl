-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "portl_gate";

-- CreateEnum
CREATE TYPE "portl_gate"."VisitorCategory" AS ENUM ('GUEST', 'DELIVERY', 'CAB', 'SERVICE');

-- CreateEnum
CREATE TYPE "portl_gate"."VisitorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "portl_gate"."MovementType" AS ENUM ('ENTRY', 'EXIT');

-- CreateTable
CREATE TABLE "portl_registry"."Gate" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_registry"."GuardAssignment" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_gate"."VisitorRequest" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "category" "portl_gate"."VisitorCategory" NOT NULL,
    "company" TEXT,
    "status" "portl_gate"."VisitorStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedUntil" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "VisitorRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_gate"."RequestRecipient" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occupancyId" TEXT NOT NULL,
    "occupancyStartedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_gate"."Visit" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "enteredBy" TEXT NOT NULL,
    "exitedAt" TIMESTAMP(3),
    "exitedBy" TEXT,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_gate"."MovementEvent" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" "portl_gate"."MovementType" NOT NULL,
    "gateId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_gate"."GateCommandReceipt" (
    "societyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateCommandReceipt_pkey" PRIMARY KEY ("societyId","actorId","intentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Gate_societyId_id_key" ON "portl_registry"."Gate"("societyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Gate_societyId_name_key" ON "portl_registry"."Gate"("societyId", "name");

-- CreateIndex
CREATE INDEX "GuardAssignment_societyId_userId_active_idx" ON "portl_registry"."GuardAssignment"("societyId", "userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "GuardAssignment_societyId_gateId_userId_key" ON "portl_registry"."GuardAssignment"("societyId", "gateId", "userId");

-- CreateIndex
CREATE INDEX "VisitorRequest_societyId_createdAt_id_idx" ON "portl_gate"."VisitorRequest"("societyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "VisitorRequest_societyId_status_expiresAt_idx" ON "portl_gate"."VisitorRequest"("societyId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorRequest_societyId_id_key" ON "portl_gate"."VisitorRequest"("societyId", "id");

-- CreateIndex
CREATE INDEX "RequestRecipient_societyId_userId_requestId_idx" ON "portl_gate"."RequestRecipient"("societyId", "userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestRecipient_requestId_userId_key" ON "portl_gate"."RequestRecipient"("requestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_requestId_key" ON "portl_gate"."Visit"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_societyId_id_key" ON "portl_gate"."Visit"("societyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_societyId_requestId_key" ON "portl_gate"."Visit"("societyId", "requestId");

-- CreateIndex
CREATE INDEX "MovementEvent_societyId_createdAt_idx" ON "portl_gate"."MovementEvent"("societyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MovementEvent_visitId_type_key" ON "portl_gate"."MovementEvent"("visitId", "type");

-- AddForeignKey
ALTER TABLE "portl_registry"."Gate" ADD CONSTRAINT "Gate_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_registry"."GuardAssignment" ADD CONSTRAINT "GuardAssignment_societyId_gateId_fkey" FOREIGN KEY ("societyId", "gateId") REFERENCES "portl_registry"."Gate"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."VisitorRequest" ADD CONSTRAINT "VisitorRequest_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "portl_registry"."Society"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."VisitorRequest" ADD CONSTRAINT "VisitorRequest_societyId_gateId_fkey" FOREIGN KEY ("societyId", "gateId") REFERENCES "portl_registry"."Gate"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."VisitorRequest" ADD CONSTRAINT "VisitorRequest_societyId_flatId_fkey" FOREIGN KEY ("societyId", "flatId") REFERENCES "portl_registry"."Flat"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."RequestRecipient" ADD CONSTRAINT "RequestRecipient_societyId_requestId_fkey" FOREIGN KEY ("societyId", "requestId") REFERENCES "portl_gate"."VisitorRequest"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."Visit" ADD CONSTRAINT "Visit_societyId_requestId_fkey" FOREIGN KEY ("societyId", "requestId") REFERENCES "portl_gate"."VisitorRequest"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."MovementEvent" ADD CONSTRAINT "MovementEvent_societyId_visitId_fkey" FOREIGN KEY ("societyId", "visitId") REFERENCES "portl_gate"."Visit"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_gate"."MovementEvent" ADD CONSTRAINT "MovementEvent_societyId_gateId_fkey" FOREIGN KEY ("societyId", "gateId") REFERENCES "portl_registry"."Gate"("societyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant boundaries and immutable event identities are enforced below the API.
ALTER TABLE portl_registry."GuardAssignment" ADD CONSTRAINT guard_user FOREIGN KEY ("userId") REFERENCES portl_auth."User"(id);
ALTER TABLE portl_gate."RequestRecipient" ADD CONSTRAINT recipient_occupancy FOREIGN KEY ("occupancyId") REFERENCES portl_registry."Occupancy"(id);
ALTER TABLE portl_gate."VisitorRequest" ADD CONSTRAINT request_version CHECK (version > 0),
 ADD CONSTRAINT request_approval CHECK ((status = 'APPROVED') = ("approvedUntil" IS NOT NULL)),
 ADD CONSTRAINT request_decision CHECK ((status IN ('APPROVED','REJECTED')) = ("decidedAt" IS NOT NULL AND "decidedBy" IS NOT NULL));
ALTER TABLE portl_gate."Visit" ADD CONSTRAINT visit_exit CHECK (("exitedAt" IS NULL) = ("exitedBy" IS NULL)),
 ADD CONSTRAINT visit_time CHECK ("exitedAt" IS NULL OR "exitedAt" >= "enteredAt");

ALTER TABLE portl_registry."Gate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."Gate" FORCE ROW LEVEL SECURITY;
CREATE POLICY gate_read ON portl_registry."Gate" FOR SELECT USING (portl_registry.scoped("societyId"));
CREATE POLICY gate_insert ON portl_registry."Gate" FOR INSERT WITH CHECK (portl_registry.is_admin("societyId"));
ALTER TABLE portl_registry."GuardAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_registry."GuardAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY assignment_read ON portl_registry."GuardAssignment" FOR SELECT USING (portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId")));
CREATE POLICY assignment_insert ON portl_registry."GuardAssignment" FOR INSERT WITH CHECK (portl_registry.is_admin("societyId") AND "createdBy" = portl_registry.actor());
CREATE POLICY assignment_update ON portl_registry."GuardAssignment" FOR UPDATE USING (portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))) WITH CHECK (portl_registry.is_admin("societyId"));
CREATE POLICY guard_membership_insert ON portl_registry."Membership" FOR INSERT WITH CHECK (role = 'GUARD' AND portl_registry.is_admin("societyId"));
CREATE POLICY guard_membership_update ON portl_registry."Membership" FOR UPDATE USING (role = 'GUARD' AND portl_registry.scoped("societyId") AND ("userId" = portl_registry.actor() OR portl_registry.is_admin("societyId"))) WITH CHECK (role = 'GUARD' AND portl_registry.is_admin("societyId"));

CREATE FUNCTION portl_gate.is_guard(sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT portl_registry.scoped(sid) AND EXISTS (
  SELECT 1 FROM portl_registry."Membership" m JOIN portl_registry."GuardAssignment" a ON a."societyId" = m."societyId" AND a."userId" = m."userId"
  JOIN portl_registry."Gate" g ON g.id = a."gateId" AND g."societyId" = a."societyId"
  WHERE m."societyId" = sid AND m."userId" = portl_registry.actor() AND m.role = 'GUARD' AND m.active AND a.active AND g.active)
$$;
CREATE POLICY guard_occupancy_read ON portl_registry."Occupancy" FOR SELECT USING (portl_gate.is_guard("societyId"));
CREATE POLICY guard_occupancy_lock ON portl_registry."Occupancy" FOR UPDATE USING (portl_gate.is_guard("societyId")) WITH CHECK (false);
CREATE POLICY gate_lock ON portl_registry."Gate" FOR UPDATE USING (portl_gate.is_guard("societyId") OR portl_registry.is_admin("societyId")) WITH CHECK (false);
CREATE POLICY flat_lock ON portl_registry."Flat" FOR UPDATE USING (portl_gate.is_guard("societyId")) WITH CHECK (false);
CREATE POLICY society_lock ON portl_registry."Society" FOR UPDATE USING (portl_gate.is_guard(id)) WITH CHECK (false);

ALTER TABLE portl_gate."RequestRecipient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_gate."RequestRecipient" FORCE ROW LEVEL SECURITY;
CREATE POLICY recipient_read ON portl_gate."RequestRecipient" FOR SELECT USING (
 portl_registry.scoped("societyId") AND (portl_gate.is_guard("societyId") OR portl_registry.is_admin("societyId") OR
 ("userId" = portl_registry.actor() AND EXISTS (SELECT 1 FROM portl_registry."Occupancy" o JOIN portl_registry."Membership" m ON m."societyId" = o."societyId" AND m."userId" = o."userId" AND m.role = 'RESIDENT' AND m.active
 WHERE o.id = "occupancyId" AND o."societyId" = "RequestRecipient"."societyId" AND o."userId" = "RequestRecipient"."userId" AND o."startedAt" = "occupancyStartedAt" AND o."endedAt" IS NULL)))
);
CREATE POLICY recipient_insert ON portl_gate."RequestRecipient" FOR INSERT WITH CHECK (portl_gate.is_guard("societyId"));
CREATE FUNCTION portl_gate.is_recipient(sid text, rid text, uid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT portl_registry.scoped(sid) AND EXISTS (
 SELECT 1 FROM portl_gate."RequestRecipient" r JOIN portl_registry."Occupancy" o ON o.id = r."occupancyId" AND o."societyId" = r."societyId" AND o."userId" = r."userId" AND o."startedAt" = r."occupancyStartedAt" AND o."endedAt" IS NULL
 JOIN portl_registry."Membership" m ON m."societyId" = r."societyId" AND m."userId" = r."userId" AND m.role = 'RESIDENT' AND m.active
 WHERE r."societyId" = sid AND r."requestId" = rid AND r."userId" = uid)
$$;
ALTER TABLE portl_gate."VisitorRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_gate."VisitorRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY request_read ON portl_gate."VisitorRequest" FOR SELECT USING (portl_gate.is_guard("societyId") OR portl_registry.is_admin("societyId") OR portl_gate.is_recipient("societyId", id, portl_registry.actor()));
CREATE POLICY request_insert ON portl_gate."VisitorRequest" FOR INSERT WITH CHECK (portl_gate.is_guard("societyId") AND "createdBy" = portl_registry.actor() AND status = 'PENDING');
CREATE POLICY request_update ON portl_gate."VisitorRequest" FOR UPDATE USING (portl_gate.is_guard("societyId") OR portl_gate.is_recipient("societyId", id, portl_registry.actor())) WITH CHECK (portl_gate.is_guard("societyId") OR (portl_gate.is_recipient("societyId", id, portl_registry.actor()) AND "decidedBy" = portl_registry.actor() AND status IN ('APPROVED','REJECTED')));
-- A guard may update movement versions, but cannot manufacture a resident decision.
CREATE FUNCTION portl_gate.check_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'Terminal visitor decision'; END IF;
  IF NEW.status IN ('APPROVED','REJECTED') AND NOT (NEW."decidedBy" = portl_registry.actor() AND portl_gate.is_recipient(NEW."societyId", NEW.id, portl_registry.actor())) THEN RAISE EXCEPTION 'Resident decision required'; END IF;
  IF NEW.status = 'CANCELLED' AND NOT portl_gate.is_guard(NEW."societyId") THEN RAISE EXCEPTION 'Guard required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visitor_decision BEFORE UPDATE ON portl_gate."VisitorRequest" FOR EACH ROW EXECUTE FUNCTION portl_gate.check_decision();
ALTER TABLE portl_gate."Visit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_gate."Visit" FORCE ROW LEVEL SECURITY;
CREATE POLICY visit_read ON portl_gate."Visit" FOR SELECT USING (EXISTS (SELECT 1 FROM portl_gate."VisitorRequest" r WHERE r.id = "requestId" AND r."societyId" = "Visit"."societyId"));
CREATE POLICY visit_insert ON portl_gate."Visit" FOR INSERT WITH CHECK (portl_gate.is_guard("societyId") AND "enteredBy" = portl_registry.actor());
CREATE POLICY visit_update ON portl_gate."Visit" FOR UPDATE USING (portl_gate.is_guard("societyId")) WITH CHECK (portl_gate.is_guard("societyId") AND "exitedBy" = portl_registry.actor());
ALTER TABLE portl_gate."MovementEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_gate."MovementEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY movement_read ON portl_gate."MovementEvent" FOR SELECT USING (EXISTS (SELECT 1 FROM portl_gate."Visit" v WHERE v.id = "visitId" AND v."societyId" = "MovementEvent"."societyId"));
CREATE POLICY movement_insert ON portl_gate."MovementEvent" FOR INSERT WITH CHECK (portl_gate.is_guard("societyId") AND "actorId" = portl_registry.actor());
ALTER TABLE portl_gate."GateCommandReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE portl_gate."GateCommandReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_read ON portl_gate."GateCommandReceipt" FOR SELECT USING (portl_registry.scoped("societyId") AND "actorId" = portl_registry.actor());
CREATE POLICY receipt_insert ON portl_gate."GateCommandReceipt" FOR INSERT WITH CHECK (portl_registry.scoped("societyId") AND "actorId" = portl_registry.actor());
REVOKE ALL ON FUNCTION portl_gate.is_guard(text), portl_gate.is_recipient(text,text,text), portl_gate.check_decision() FROM PUBLIC;

-- A bounded boolean avoids exposing another household member's occupancy record.
-- The owner bypass is limited to an already-authorized request and fixed SQL.
CREATE FUNCTION portl_gate.approval_current(sid text, rid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT portl_registry.scoped(sid)
 AND (portl_gate.is_guard(sid) OR portl_registry.is_admin(sid) OR portl_gate.is_recipient(sid,rid,portl_registry.actor()))
 AND EXISTS (
 SELECT 1 FROM portl_gate."VisitorRequest" q
 JOIN portl_gate."RequestRecipient" r ON r."requestId" = q.id AND r."societyId" = q."societyId" AND r."userId" = q."decidedBy"
 JOIN portl_registry."Occupancy" o ON o.id = r."occupancyId" AND o."societyId" = r."societyId" AND o."flatId" = q."flatId" AND o."userId" = r."userId" AND o."startedAt" = r."occupancyStartedAt" AND o."endedAt" IS NULL
 JOIN portl_registry."Membership" m ON m."societyId" = q."societyId" AND m."userId" = r."userId" AND m.role = 'RESIDENT' AND m.active
 WHERE q."societyId" = sid AND q.id = rid AND q.status = 'APPROVED')
$$;
REVOKE ALL ON FUNCTION portl_gate.approval_current(text,text) FROM PUBLIC;
