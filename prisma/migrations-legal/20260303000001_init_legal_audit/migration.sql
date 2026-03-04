-- Initialize legal audit database
-- Immutable compliance records - no FK constraints (org data lives in separate DB)
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "org_id" UUID,
    "actor_role" TEXT,
    "trigger_type" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- Indexes for common query patterns
CREATE INDEX "audit_events_org_id_created_at_idx" ON "audit_events"("org_id", "created_at" DESC);
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at" DESC);
