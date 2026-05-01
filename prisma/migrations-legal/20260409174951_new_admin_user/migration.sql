-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "auth0_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_auth0_id_key" ON "admin_users"("auth0_id");

-- CreateIndex
CREATE INDEX "admin_users_email_idx" ON "admin_users"("email");
