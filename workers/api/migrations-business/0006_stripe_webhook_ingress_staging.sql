-- Local/staging preparation only: Stripe receipt and durable dispatch state.
-- This schema does not apply billing effects and does not store raw payloads.

CREATE TABLE "stripe_webhook_receipts" (
  "id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("id") = 36 AND substr("id", 9, 1) = '-' AND substr("id", 14, 1) = '-' AND
      substr("id", 19, 1) = '-' AND substr("id", 24, 1) = '-' AND
      replace("id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "stripe_event_id" TEXT NOT NULL CHECK (length(trim("stripe_event_id")) > 0),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "event_type" TEXT NOT NULL CHECK (length(trim("event_type")) > 0),
  "object_type" TEXT,
  "object_id" TEXT,
  "api_version" TEXT,
  "normalized_schema_version" INTEGER NOT NULL CHECK (
    typeof("normalized_schema_version") = 'integer' AND "normalized_schema_version" > 0
  ),
  "normalized_payload" TEXT NOT NULL CHECK (
    json_valid("normalized_payload") AND json_type("normalized_payload") = 'object'
  ),
  "normalized_payload_sha256" TEXT NOT NULL CHECK (
    length("normalized_payload_sha256") = 64 AND
    "normalized_payload_sha256" NOT GLOB '*[^0-9a-f]*'
  ),
  "raw_payload_sha256" TEXT NOT NULL CHECK (
    length("raw_payload_sha256") = 64 AND "raw_payload_sha256" NOT GLOB '*[^0-9a-f]*'
  ),
  "status" TEXT NOT NULL DEFAULT 'received' CHECK (
    "status" IN ('received', 'processing', 'retryable', 'applied', 'ignored', 'dead_letter')
  ),
  "delivery_count" INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof("delivery_count") = 'integer' AND "delivery_count" > 0
  ),
  "first_received_at" TEXT NOT NULL,
  "last_received_at" TEXT NOT NULL,
  "terminal_at" TEXT,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (
    ("status" IN ('applied', 'ignored', 'dead_letter') AND "terminal_at" IS NOT NULL) OR
    ("status" NOT IN ('applied', 'ignored', 'dead_letter') AND "terminal_at" IS NULL)
  ),
  UNIQUE ("livemode", "stripe_event_id"),
  UNIQUE ("id", "livemode", "stripe_event_id")
);

CREATE TABLE "stripe_webhook_dispatches" (
  "id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("id") = 36 AND substr("id", 9, 1) = '-' AND substr("id", 14, 1) = '-' AND
      substr("id", 19, 1) = '-' AND substr("id", 24, 1) = '-' AND
      replace("id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "receipt_id" TEXT NOT NULL,
  "stripe_event_id" TEXT NOT NULL CHECK (length(trim("stripe_event_id")) > 0),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK (
    "status" IN ('pending', 'processing', 'retryable', 'completed', 'dead_letter')
  ),
  "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof("attempt_count") = 'integer' AND "attempt_count" >= 0
  ),
  "available_at" TEXT NOT NULL,
  "claimed_at" TEXT,
  "lease_until" TEXT,
  "lease_token" TEXT,
  "claim_generation" INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof("claim_generation") = 'integer' AND "claim_generation" BETWEEN 0 AND 9007199254740991
  ),
  "completed_at" TEXT,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (
    ("status" = 'completed' AND "completed_at" IS NOT NULL) OR
    ("status" <> 'completed' AND "completed_at" IS NULL)
  ),
  CHECK (
    ("status" = 'processing' AND "claimed_at" IS NOT NULL AND "lease_until" IS NOT NULL AND
      "lease_token" IS NOT NULL AND "claim_generation" > 0) OR
    ("status" <> 'processing' AND "claimed_at" IS NULL AND "lease_until" IS NULL AND
      "lease_token" IS NULL)
  ),
  FOREIGN KEY ("receipt_id", "livemode", "stripe_event_id")
    REFERENCES "stripe_webhook_receipts" ("id", "livemode", "stripe_event_id") ON DELETE CASCADE,
  UNIQUE ("receipt_id"),
  UNIQUE ("livemode", "stripe_event_id")
);

CREATE INDEX "stripe_webhook_receipts_status_idx"
  ON "stripe_webhook_receipts" ("status", "last_received_at");
CREATE INDEX "stripe_webhook_dispatches_ready_idx"
  ON "stripe_webhook_dispatches" ("status", "available_at")
  WHERE "status" IN ('pending', 'retryable');
CREATE INDEX "stripe_webhook_dispatches_claim_idx"
  ON "stripe_webhook_dispatches" ("livemode", "status", "available_at", "lease_until", "receipt_id")
  WHERE "status" IN ('pending', 'retryable', 'processing');
