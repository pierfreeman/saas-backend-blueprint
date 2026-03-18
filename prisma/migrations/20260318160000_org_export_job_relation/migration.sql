-- AddForeignKey
ALTER TABLE "org_exports" ADD CONSTRAINT "org_exports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
