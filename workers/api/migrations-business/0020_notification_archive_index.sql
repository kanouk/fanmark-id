CREATE INDEX "idx_notifications_archive_due"
  ON "notifications" ("created_at", "id")
  WHERE "status" IN ('delivered', 'failed');
