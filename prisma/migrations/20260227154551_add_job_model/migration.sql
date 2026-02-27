-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'heavy_job',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_org_id_created_at_idx" ON "jobs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_org_id_status_idx" ON "jobs"("org_id", "status");

-- CreateIndex
CREATE INDEX "jobs_user_id_created_at_idx" ON "jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_created_at_idx" ON "jobs"("status", "created_at" DESC);
