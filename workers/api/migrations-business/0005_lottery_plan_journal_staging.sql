-- STAGING ONLY: persist exact lottery inputs and replayable outcomes.
-- This carries only the existing lifecycle journal columns, if any; no user rows are copied.

ALTER TABLE "license_grace_finalization_items"
RENAME TO "license_grace_finalization_items_before_lottery_journal";

CREATE TABLE "license_grace_finalization_items" (
  "run_id" TEXT NOT NULL REFERENCES "license_grace_finalization_runs"("run_id"),
  "license_id" TEXT NOT NULL REFERENCES "fanmark_licenses"("id"),
  "fanmark_id" TEXT NOT NULL REFERENCES "fanmarks"("id"),
  "fanmark_short_id" TEXT NOT NULL,
  "fanmark_name" TEXT NOT NULL,
  "user_id" TEXT,
  "license_end" TEXT,
  "grace_expires_at" TEXT NOT NULL,
  "is_returned" INTEGER NOT NULL CHECK (typeof("is_returned") = 'integer' AND "is_returned" IN (0, 1)),
  "license_incarnation" INTEGER NOT NULL CHECK (typeof("license_incarnation") = 'integer' AND "license_incarnation" BETWEEN 0 AND 9007199254740991),
  "license_lifecycle_generation" INTEGER NOT NULL CHECK (typeof("license_lifecycle_generation") = 'integer' AND "license_lifecycle_generation" BETWEEN 0 AND 9007199254740991),
  "access_generation" INTEGER NOT NULL CHECK (typeof("access_generation") = 'integer' AND "access_generation" BETWEEN 0 AND 9007199254740991),
  "operation_id" TEXT NOT NULL,
  "audit_id" TEXT NOT NULL,
  "notification_event_id" TEXT NOT NULL,
  "lottery_seed" TEXT CHECK ("lottery_seed" IS NULL OR (length("lottery_seed") = 64 AND "lottery_seed" NOT GLOB '*[^0-9a-f]*')),
  "lottery_inputs_json" TEXT CHECK ("lottery_inputs_json" IS NULL OR (json_valid("lottery_inputs_json") AND json_type("lottery_inputs_json") = 'object')),
  "lottery_plan_json" TEXT CHECK ("lottery_plan_json" IS NULL OR (json_valid("lottery_plan_json") AND json_type("lottery_plan_json") = 'object')),
  "outcome" TEXT NOT NULL DEFAULT 'pending' CHECK ("outcome" IN ('pending', 'processed', 'conflict')),
  "completed_at" TEXT,
  CHECK ("lottery_seed" IS NOT NULL OR ("lottery_inputs_json" IS NULL AND "lottery_plan_json" IS NULL)),
  CHECK ("lottery_inputs_json" IS NULL OR "lottery_seed" IS NOT NULL),
  CHECK ("lottery_plan_json" IS NULL OR "lottery_inputs_json" IS NOT NULL),
  PRIMARY KEY ("run_id", "license_id"),
  UNIQUE ("run_id", "operation_id"),
  UNIQUE ("run_id", "audit_id"),
  UNIQUE ("run_id", "notification_event_id")
);

INSERT INTO "license_grace_finalization_items" (
  "run_id", "license_id", "fanmark_id", "fanmark_short_id", "fanmark_name",
  "user_id", "license_end", "grace_expires_at", "is_returned",
  "license_incarnation", "license_lifecycle_generation", "access_generation",
  "operation_id", "audit_id", "notification_event_id", "outcome", "completed_at"
)
SELECT
  "run_id", "license_id", "fanmark_id", "fanmark_short_id", "fanmark_name",
  "user_id", "license_end", "grace_expires_at", "is_returned",
  "license_incarnation", "license_lifecycle_generation", "access_generation",
  "operation_id", "audit_id", "notification_event_id", "outcome", "completed_at"
FROM "license_grace_finalization_items_before_lottery_journal";

DROP TABLE "license_grace_finalization_items_before_lottery_journal";

CREATE INDEX "license_grace_finalization_items_cursor"
ON "license_grace_finalization_items" ("run_id", "license_id");
