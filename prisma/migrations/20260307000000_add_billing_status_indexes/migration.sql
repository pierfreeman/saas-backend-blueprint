-- CreateIndex: filter by billing status (e.g. list all PAST_DUE orgs)
CREATE INDEX "organizations_billing_status_idx" ON "organizations"("billing_status");

-- CreateIndex: paginated admin listings filtered by billing status, ordered by creation date
CREATE INDEX "organizations_billing_status_created_at_idx" ON "organizations"("billing_status", "created_at" DESC);
