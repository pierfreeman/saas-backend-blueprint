-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN "user_id" UUID;

-- CreateIndex
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events"("user_id", "created_at" DESC);
