/*
  Warnings:

  - You are about to drop the column `is_system_admin` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "is_system_admin";
