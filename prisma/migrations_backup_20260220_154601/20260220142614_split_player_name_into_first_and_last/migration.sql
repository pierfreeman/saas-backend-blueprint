/*
  Warnings:

  - You are about to drop the column `name` on the `players` table. All the data in the column will be lost.
  - Added the required column `firstName` to the `players` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `players` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('S3', 'AZURE');

-- CreateEnum
CREATE TYPE "FileEntityType" AS ENUM ('ORG', 'TEAM', 'PLAYER', 'GENERIC');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('INITIATED', 'UPLOADING', 'COMPLETED', 'ABORTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "players" DROP COLUMN "name",
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_provider" "StorageProvider" NOT NULL,
    "bucket_or_container" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "entity_type" "FileEntityType",
    "entity_id" UUID,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "expected_size" BIGINT NOT NULL,
    "storage_provider" "StorageProvider" NOT NULL,
    "upload_provider_id" TEXT,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'INITIATED',
    "expected_parts" INTEGER,
    "uploaded_parts" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_org_id_idx" ON "files"("org_id");

-- CreateIndex
CREATE INDEX "files_uploaded_by_user_id_idx" ON "files"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "files_entity_type_entity_id_idx" ON "files"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "files_storage_provider_storage_key_idx" ON "files"("storage_provider", "storage_key");

-- CreateIndex
CREATE INDEX "files_created_at_idx" ON "files"("created_at");

-- CreateIndex
CREATE INDEX "upload_sessions_org_id_idx" ON "upload_sessions"("org_id");

-- CreateIndex
CREATE INDEX "upload_sessions_user_id_idx" ON "upload_sessions"("user_id");

-- CreateIndex
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions"("status");

-- CreateIndex
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "upload_sessions_created_at_idx" ON "upload_sessions"("created_at");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
