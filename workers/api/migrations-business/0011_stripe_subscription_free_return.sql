-- Atomic, auditable free-plan returns produced by a deleted Stripe subscription.
CREATE TABLE "stripe_subscription_return_batches" (
  "application_id" TEXT NOT NULL PRIMARY KEY,
  "local_user_id" TEXT NOT NULL
    CHECK (length("local_user_id") = 36 AND substr("local_user_id", 9, 1) = '-' AND
      substr("local_user_id", 14, 1) = '-' AND substr("local_user_id", 19, 1) = '-' AND
      substr("local_user_id", 24, 1) = '-' AND
      replace("local_user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "free_limit" INTEGER NOT NULL
    CHECK (typeof("free_limit") = 'integer' AND "free_limit" > 0),
  "active_license_count" INTEGER NOT NULL
    CHECK (typeof("active_license_count") = 'integer' AND "active_license_count" >= 0),
  "returned_license_count" INTEGER NOT NULL
    CHECK (typeof("returned_license_count") = 'integer' AND
      "returned_license_count" >= 0 AND "returned_license_count" <= "active_license_count"),
  "returned_at" TEXT NOT NULL,
  "grace_expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("application_id")
    REFERENCES "stripe_subscription_applications" ("id") ON DELETE CASCADE
);

CREATE TABLE "stripe_subscription_return_items" (
  "application_id" TEXT NOT NULL,
  "license_id" TEXT NOT NULL,
  "fanmark_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "display_fanmark" TEXT,
  "short_id" TEXT,
  "returned_at" TEXT NOT NULL,
  "grace_expires_at" TEXT NOT NULL,
  PRIMARY KEY ("application_id", "license_id"),
  FOREIGN KEY ("application_id")
    REFERENCES "stripe_subscription_return_batches" ("application_id") ON DELETE CASCADE,
  FOREIGN KEY ("license_id")
    REFERENCES "fanmark_licenses" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("fanmark_id")
    REFERENCES "fanmarks" ("id") ON DELETE CASCADE
);

CREATE INDEX "stripe_subscription_return_items_license_idx"
  ON "stripe_subscription_return_items" ("license_id", "application_id");
