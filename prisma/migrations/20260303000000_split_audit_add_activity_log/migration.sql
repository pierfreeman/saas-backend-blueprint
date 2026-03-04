-- Split audit into ActivityLog (business DB) + LegalAudit (separate DB)
-- Phase 1: Create app_audit schema
CREATE SCHEMA IF NOT EXISTS "app_audit";

-- Phase 2: Create activity_logs table in app_audit schema
CREATE TABLE "app_audit"."activity_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- Phase 3: Create indexes
CREATE INDEX "activity_logs_org_id_created_at_idx" ON "app_audit"."activity_logs"("org_id", "created_at" DESC);
CREATE INDEX "activity_logs_action_created_at_idx" ON "app_audit"."activity_logs"("action", "created_at" DESC);

-- Phase 4: Add cascade FK to organizations
ALTER TABLE "app_audit"."activity_logs" ADD CONSTRAINT "activity_logs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 5: Drop old audit_events table and AuditSeverity enum (clean slate - no data migration)
DROP TABLE IF EXISTS "public"."audit_events";
DROP TYPE IF EXISTS "public"."AuditSeverity";
