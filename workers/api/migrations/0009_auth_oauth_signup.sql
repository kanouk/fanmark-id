-- Server-only recovery state for new OAuth identities. Existing users remain
-- unmarked. Business profile IDs are assigned before any cross-D1 write.
ALTER TABLE "user" ADD COLUMN "oauthSignupCommandId" text;
ALTER TABLE "user" ADD COLUMN "oauthSignupProfileId" text;
ALTER TABLE "user" ADD COLUMN "oauthSignupProvider" text;
ALTER TABLE "user" ADD COLUMN "oauthSignupSubject" text;
ALTER TABLE "user" ADD COLUMN "oauthSignupLanguage" text;
ALTER TABLE "user" ADD COLUMN "oauthSignupState" text
  CHECK ("oauthSignupState" IS NULL OR "oauthSignupState" IN ('pending', 'completed'));

CREATE UNIQUE INDEX "user_oauthSignupCommandId_key"
  ON "user" ("oauthSignupCommandId") WHERE "oauthSignupCommandId" IS NOT NULL;
CREATE UNIQUE INDEX "user_oauthSignupProfileId_key"
  ON "user" ("oauthSignupProfileId") WHERE "oauthSignupProfileId" IS NOT NULL;
CREATE UNIQUE INDEX "user_oauthSignupIdentity_key"
  ON "user" ("oauthSignupProvider", "oauthSignupSubject")
  WHERE "oauthSignupSubject" IS NOT NULL;

-- Account-key recovery must not create two owners for the same provider key.
-- Before importing existing identities, separately reject/reconcile duplicates.
CREATE UNIQUE INDEX "account_providerId_accountId_key"
  ON "account" ("providerId", "accountId");
