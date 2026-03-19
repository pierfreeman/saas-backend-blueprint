-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "org_exports" (
    "id" UUID NOT NULL,
    "org_id" TEXT NOT NULL,
    "job_id" UUID NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "file_url" TEXT,
    "file_size" BIGINT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "org_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_exports_job_id_key" ON "org_exports"("job_id");

-- CreateIndex
CREATE INDEX "org_exports_org_id_created_at_idx" ON "org_exports"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "org_exports_org_id_status_idx" ON "org_exports"("org_id", "status");

-- CreateIndex
CREATE INDEX "org_exports_requested_by_user_id_created_at_idx" ON "org_exports"("requested_by_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "org_exports_status_expires_at_idx" ON "org_exports"("status", "expires_at");
