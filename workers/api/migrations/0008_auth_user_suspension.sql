-- Auth account suspension state, session fence, and same-database audit journal.
-- The admin UI reaches these fields only through the MFA-protected Worker API.
ALTER TABLE "user" ADD COLUMN "banned" integer NOT NULL DEFAULT 0 CHECK ("banned" IN (0, 1));
ALTER TABLE "user" ADD COLUMN "banReason" text;
ALTER TABLE "user" ADD COLUMN "banExpires" date;

CREATE TABLE "adminUserStatusAudit" (
  "id" text NOT NULL PRIMARY KEY,
  "actorUserId" text NOT NULL,
  "targetUserId" text NOT NULL,
  "action" text NOT NULL CHECK ("action" IN ('ADMIN_SUSPEND_USER', 'ADMIN_RESTORE_USER')),
  "reason" text CHECK ("reason" IS NULL OR length("reason") <= 2000),
  "banExpires" date,
  "createdAt" date NOT NULL
);

CREATE INDEX "adminUserStatusAudit_target_created_idx"
  ON "adminUserStatusAudit" ("targetUserId", "createdAt" DESC);

-- Close the race where a sign-in passed the application hook before an admin
-- suspension committed, then attempted to insert its session afterward.
CREATE TRIGGER "session_reject_suspended_user"
BEFORE INSERT ON "session"
WHEN EXISTS (
  SELECT 1 FROM "user" AS u
  WHERE u."id" = NEW."userId"
    AND u."banned" = 1
    AND (
      u."banExpires" IS NULL
      OR julianday(u."banExpires") IS NULL
      OR julianday(u."banExpires") > julianday('now')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'BANNED_USER');
END;
