-- AlterTable
ALTER TABLE "events" ADD COLUMN     "last_reminder_occurrence_utc" TIMESTAMP(3),
ADD COLUMN     "reminder_minutes" INTEGER;

-- CreateIndex
CREATE INDEX "events_reminder_minutes_deleted_at_idx" ON "events"("reminder_minutes", "deleted_at");
