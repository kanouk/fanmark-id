# R2 application Storage API

This is the Worker-side replacement boundary for the existing public
`avatars` and `cover-images` Supabase Storage buckets. It does not copy source
objects. The R2 frontend selector is active only in the workers.dev staging
build; production builds continue to default to Supabase.

## API contract

The Worker handles these routes only when both R2 bucket bindings and
`STORAGE_BACKEND=r2` are configured:

- `GET` / `HEAD /api/storage/public/{bucket}/{key}` serves a public object.
- `POST /api/storage/object/{bucket}` accepts a raw image body. A valid Better
  Auth session is required; the server chooses the object key and returns
  `{ path, publicUrl }`.
- `DELETE /api/storage/object/{bucket}/{key}` requires a valid Better Auth
  session whose user ID is the first key segment.

Only `avatars` and `cover-images` are accepted. Avatar bodies are limited to
1 MiB; cover bodies are limited to 2 MiB. JPEG, PNG, GIF, WebP, and AVIF are
accepted after a header signature check. Public responses retain a one-hour
cache lifetime and set `X-Content-Type-Options: nosniff`. Mutation requests
require an allowlisted `Origin` and use credentialed CORS. Unknown backend or
missing bindings fail closed.

The frontend has a bounded client for this contract, and the avatar/cover
hooks select it with `VITE_STORAGE_BACKEND=r2` in the Cloudflare staging build.
Other builds default to Supabase. R2 selection requires the Cloudflare staging auth mode, sends the
Better Auth cookie, validates the returned owner path and same-origin public
URL, and never falls back to Supabase after an R2 error. The account, two
staging buckets, Worker bindings, and synthetic live upload/read/delete smoke
are verified below; production Storage is unchanged.

The local Worker integration test uses fixture Better Auth accounts and
Miniflare D1/R2. It checks public read, owner-only delete, auth, CORS, image
signatures, path handling, response headers, and size limits. The frontend
contract test checks the explicit selector, bounded response, upload/delete
request shape, URL ownership, and fail-closed behavior:

```sh
npm run --prefix workers/api test:storage-r2-api
npm run --prefix workers/api typecheck
npm run test:storage-api
npm run typecheck
```

## Current boundary

R2 is enabled for the account. Two APAC Standard staging buckets,
`fanmark-avatars-staging` and `fanmark-cover-images-staging`, are bound to the
staging Worker, which now has `STORAGE_BACKEND=r2`. A temporary synthetic
`example.invalid` account successfully signed in through the dedicated Auth D1,
uploaded a 16-byte PNG, read it through the public Worker route, and deleted it
through the owner-checked route. The follow-up public read returned 404. The
synthetic user and its account/session rows were removed, and the final Auth
readback found all user-owned tables empty. No object remains from this smoke.

New avatar and cover uploads from the workers.dev staging app now use R2;
production remains on Supabase Storage. Profile metadata and the broader
settings save flow are not fully cut over, and existing Supabase objects were
not copied. These checks do not prove browser image decoding, full profile
integration, production limits, or object migration. Supabase Storage inventory
and object reconciliation remain in the excluded user-data stage.

On 2026-09-25, `fanmark-app-staging` was redeployed as version
`1d1bae79-5793-4341-9b1f-540a55376695` with both R2 bindings. A fresh
read-only public GET for a missing synthetic key returned 404
`object_not_found`; a no-session upload returned 401 `unauthorized`, confirming
that the route is live and still enforces authentication. This smoke did not
upload an object or change the frontend selector.

Cloudflare's Standard free allowance is 10 GB-month storage, 1 million Class A
operations, and 10 million Class B operations per month; usage beyond those
allowances is billed. The synthetic canary objects were deleted; the tested
object key returned 404 after deletion. The account invoice/dashboard was not
inspected. See [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
and [R2 setup](https://developers.cloudflare.com/r2/get-started/).

## Staging frontend activation (2026-09-25)

The normal `build:cloudflare-staging` command now selects
`VITE_STORAGE_BACKEND=r2`, alongside the five authenticated owner API
selectors. The app Worker remains configured with `STORAGE_BACKEND=r2` and the
two staging buckets. After deployment as version
`3246cbf2-642f-47f2-a107-0a8a116a8f8a`, a synthetic Better Auth account
uploaded a valid 1×1 PNG to the avatar bucket, read back identical bytes through
the public route, deleted it through the owner-checked route, and confirmed the
public route returned 404. The same account and session were deleted and Auth
and business D1 cleanup readback was zero. Local Worker tests pass 5/5, the
storage-client contract suite passes 7/7, Worker typecheck passes, and staging
build/deploy dry-run pass. No existing object or real user data was copied.

## Profile metadata and R2 avatar integration proof (2026-09-25)

The profile D1 fixture now also binds local Miniflare R2. One synthetic
Better Auth identity uploads an avatar, reads the exact public bytes, saves
the returned URL through `PATCH /api/me/profile`, reads it back, and is denied
when attempting to save the same key under another user's path. The owner
then deletes the object and clears the profile URL; D1 readback is null and the
public object route returns 404. The profile suite passes 6/6 and the
standalone storage suite passes 5/5.

The same sequence also passed on workers.dev staging with a one-time
`example.invalid` Better Auth user. Anonymous profile read/upload returned
401; authenticated profile read, R2 upload, public read, profile save/readback,
owner object delete, and profile clear returned expected results; a foreign
owner URL was rejected with 400. Final readback found zero user, account,
session, or profile rows and the uploaded URL returned 404. The repeatable
canary is `npm run test:staging-r2-profile-smoke`. This still does not move
existing Supabase user rows or objects, prove browser image decoding, or alter
production routing.

After R2 activation, the same staging canary was extended to verify the second
bucket as well. The synthetic identity uploaded to `cover-images`, read
identical public bytes, deleted its own object, and received 404 after cleanup.
Cloudflare account inventory confirmed both expected bucket names. The live
avatar and cover SHA-256 values matched; all synthetic D1 rows and R2 objects
were removed. This confirms the two staging bucket bindings and routes, not a
copy of any existing user object.
