-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrganizationStatus" ADD VALUE 'PENDING_DELETION';
ALTER TYPE "OrganizationStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "deletion_completed_at" TIMESTAMP(3),
ADD COLUMN     "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN     "deletion_scheduled_at" TIMESTAMP(3),
ADD COLUMN     "retention_period_days" INTEGER;
