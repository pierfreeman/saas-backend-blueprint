-- CreateEnum
CREATE TYPE "public"."FileStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'ABORTED');

-- CreateTable
CREATE TABLE "public"."files" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" BIGINT,
    "mime_type" TEXT,
    "status" "public"."FileStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "public"."files"("storage_key");

-- CreateIndex
CREATE INDEX "files_org_id_created_at_idx" ON "public"."files"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "files_org_id_status_idx" ON "public"."files"("org_id", "status");

-- CreateIndex
CREATE INDEX "files_uploaded_by_created_at_idx" ON "public"."files"("uploaded_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "files_status_expires_at_idx" ON "public"."files"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "public"."files" ADD CONSTRAINT "files_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
