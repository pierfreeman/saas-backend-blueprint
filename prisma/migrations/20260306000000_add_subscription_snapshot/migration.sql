-- CreateTable
CREATE TABLE "subscription_snapshots" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "status" TEXT NOT NULL,
    "seats" INTEGER,
    "seat_limit" INTEGER,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_snapshots_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "subscription_snapshots" ADD CONSTRAINT "subscription_snapshots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "subscription_snapshots_org_id_idx" ON "subscription_snapshots"("org_id");

-- CreateIndex
CREATE INDEX "subscription_snapshots_stripe_subscription_id_idx" ON "subscription_snapshots"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscription_snapshots_org_id_created_at_idx" ON "subscription_snapshots"("org_id", "created_at" DESC);
