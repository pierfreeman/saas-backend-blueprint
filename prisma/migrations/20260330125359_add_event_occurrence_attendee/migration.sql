-- CreateTable
CREATE TABLE "event_occurrence_attendees" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "original_start_utc" TIMESTAMP(3) NOT NULL,
    "status" "RSVPStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_occurrence_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_occurrence_attendees_event_id_idx" ON "event_occurrence_attendees"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_occurrence_attendees_event_id_user_id_original_start__key" ON "event_occurrence_attendees"("event_id", "user_id", "original_start_utc");

-- AddForeignKey
ALTER TABLE "event_occurrence_attendees" ADD CONSTRAINT "event_occurrence_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
