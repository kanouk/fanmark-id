-- Private recovery marker for the cross-D1 invitation signup coordinator.
ALTER TABLE "user" ADD COLUMN "signupCommandId" text;
CREATE UNIQUE INDEX "user_signupCommandId_key"
  ON "user" ("signupCommandId")
  WHERE "signupCommandId" IS NOT NULL;
