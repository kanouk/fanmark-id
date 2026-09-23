-- Better Auth tables for the API Worker. This migration contains no user, account, or credential rows.
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "twoFactorEnabled" integer not null default 0,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

create table "twoFactor" (
  "id" text not null primary key,
  "secret" text not null,
  "backupCodes" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "verified" integer not null default 1,
  "failedVerificationCount" integer not null default 0,
  "lockedUntil" date
);

create index "twoFactor_secret_idx" on "twoFactor" ("secret");
create index "twoFactor_userId_idx" on "twoFactor" ("userId");

create table "adminRole" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "role" text not null
);

create index "adminRole_role_idx" on "adminRole" ("role");

create table "mfaGeneration" (
  "id" integer not null primary key check ("id" = 1),
  "generation" integer not null default 0
);

create table "mfaAssurance" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "sessionId" text not null unique references "session" ("id") on delete cascade,
  "factorId" text not null references "twoFactor" ("id") on delete cascade,
  "generation" integer not null,
  "verifiedAt" date not null,
  "expiresAt" date not null
);

create index "mfaAssurance_userId_idx" on "mfaAssurance" ("userId");
create index "mfaAssurance_factorId_idx" on "mfaAssurance" ("factorId");

insert into "mfaGeneration" ("id", "generation") values (1, 0);

create trigger "mfa_generation_factor_insert"
after insert on "twoFactor"
begin
  update "mfaGeneration" set "generation" = "generation" + 1 where "id" = 1;
  delete from "mfaAssurance" where "userId" = new."userId";
end;

create trigger "mfa_generation_factor_delete"
after delete on "twoFactor"
begin
  update "mfaGeneration" set "generation" = "generation" + 1 where "id" = 1;
  delete from "mfaAssurance" where "userId" = old."userId";
end;

create trigger "mfa_generation_factor_secret_update"
after update of "secret" on "twoFactor"
when old."userId" = new."userId" and old."secret" is not new."secret"
begin
  update "mfaGeneration" set "generation" = "generation" + 1 where "id" = 1;
  delete from "mfaAssurance" where "userId" = new."userId";
end;

create trigger "mfa_generation_factor_user_update"
after update of "userId" on "twoFactor"
when old."userId" is not new."userId"
begin
  update "mfaGeneration" set "generation" = "generation" + 1 where "id" = 1;
  delete from "mfaAssurance" where "userId" = old."userId";
  delete from "mfaAssurance" where "userId" = new."userId";
end;

create trigger "mfa_generation_factor_unverify"
after update of "verified" on "twoFactor"
when old."verified" = 1 and new."verified" = 0
begin
  update "mfaGeneration" set "generation" = "generation" + 1 where "id" = 1;
  delete from "mfaAssurance" where "userId" = new."userId";
end;

create trigger "mfa_generation_user_disable"
after update of "twoFactorEnabled" on "user"
when old."twoFactorEnabled" = 1 and new."twoFactorEnabled" = 0
begin
  update "mfaGeneration" set "generation" = "generation" + 1 where "id" = 1;
  delete from "mfaAssurance" where "userId" = new."id";
end;
