-- Migration: Add Storage Tables
-- Description: Creates files and upload_sessions tables with indexes
-- Date: 2026-02-14

BEGIN;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE "StorageProvider" AS ENUM ('S3', 'AZURE');
CREATE TYPE "FileEntityType" AS ENUM ('ORG', 'TEAM', 'PLAYER', 'GENERIC');
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE "UploadSessionStatus" AS ENUM ('INITIATED', 'UPLOADING', 'COMPLETED', 'ABORTED', 'EXPIRED');

-- ============================================================================
-- FILES TABLE
-- ============================================================================

CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    
    "storage_provider" "StorageProvider" NOT NULL,
    "bucket_or_container" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    
    "file_name" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(255),
    
    "entity_type" "FileEntityType",
    "entity_id" UUID,
    
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for files table
CREATE INDEX "files_org_id_idx" ON "files"("org_id");
CREATE INDEX "files_uploaded_by_user_id_idx" ON "files"("uploaded_by_user_id");
CREATE INDEX "files_entity_type_entity_id_idx" ON "files"("entity_type", "entity_id");
CREATE INDEX "files_storage_provider_storage_key_idx" ON "files"("storage_provider", "storage_key");
CREATE INDEX "files_created_at_idx" ON "files"("created_at");

-- ============================================================================
-- UPLOAD_SESSIONS TABLE
-- ============================================================================

CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    
    "file_name" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "expected_size" BIGINT NOT NULL,
    
    "storage_provider" "StorageProvider" NOT NULL,
    "upload_provider_id" VARCHAR(500),
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'INITIATED',
    
    "expected_parts" INTEGER,
    "uploaded_parts" INTEGER NOT NULL DEFAULT 0,
    
    "metadata" JSONB,
    
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "upload_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for upload_sessions table
CREATE INDEX "upload_sessions_org_id_idx" ON "upload_sessions"("org_id");
CREATE INDEX "upload_sessions_user_id_idx" ON "upload_sessions"("user_id");
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions"("status");
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions"("expires_at");
CREATE INDEX "upload_sessions_created_at_idx" ON "upload_sessions"("created_at");

COMMIT;
