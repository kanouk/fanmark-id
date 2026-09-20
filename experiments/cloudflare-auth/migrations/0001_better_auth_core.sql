create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
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

insert into "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
values (
  '11111111-1111-4111-8111-111111111111',
  'Synthetic Legacy User',
  'legacy@example.invalid',
  1,
  null,
  '2026-09-20T00:00:00.000Z',
  '2026-09-20T00:00:00.000Z'
);

insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'credential',
  '11111111-1111-4111-8111-111111111111',
  '$2b$10$xxMZeQvcTJzcJKL8oBDGPOAlTw2M4wjhTEWPqyWomD2mSgb7tKV3q',
  '2026-09-20T00:00:00.000Z',
  '2026-09-20T00:00:00.000Z'
);
