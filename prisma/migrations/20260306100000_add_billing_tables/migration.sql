-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'TRIALING', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAUSED');

-- AlterTable: add billing columns to organizations
ALTER TABLE "organizations"
  ADD COLUMN "subscription_id"          TEXT,
  ADD COLUMN "billing_status"           "BillingStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "plan_id"                  TEXT,
  ADD COLUMN "seat_count"               INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "storage_limit"            BIGINT,
  ADD COLUMN "subscription_period_start" TIMESTAMP(3),
  ADD COLUMN "subscription_period_end"   TIMESTAMP(3),
  ADD COLUMN "cancel_at_period_end"      BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: unique on subscription_id
CREATE UNIQUE INDEX "organizations_subscription_id_key" ON "organizations"("subscription_id");

-- CreateTable: billing_events
CREATE TABLE "billing_events" (
    "id"               UUID NOT NULL,
    "org_id"           UUID,
    "stripe_event_id"  TEXT NOT NULL,
    "processed_at"     TIMESTAMP(3) NOT NULL,
    "payload_hash"     TEXT NOT NULL,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique on stripe_event_id (idempotency)
CREATE UNIQUE INDEX "billing_events_stripe_event_id_key" ON "billing_events"("stripe_event_id");

-- CreateIndex
CREATE INDEX "billing_events_stripe_event_id_idx" ON "billing_events"("stripe_event_id");

-- CreateIndex
CREATE INDEX "billing_events_processed_at_idx" ON "billing_events"("processed_at" DESC);

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
