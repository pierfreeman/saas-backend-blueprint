-- AlterTable: add optional profile fields to users
ALTER TABLE "public"."users"
  ADD COLUMN "first_name"  TEXT,
  ADD COLUMN "last_name"   TEXT,
  ADD COLUMN "picture_url" TEXT;
