# Reference master data release

The first explicit non-user reference-data release contained:

| Source table | Rows | Source SHA-256 |
| --- | ---: | --- |
| `fanmark_tiers` | 4 | `d1e407e86d72ebb4be6ab3b39c50b04da0fae3222e8b6ba3b29d1ffd17682084` |
| `languages` | 4 | `faba8449e8838a8b8982000d0582ba96aab476d296bbbc4b91fa7e704aacc637` |
| `reserved_emoji_patterns` | 5 | `36155076b6810d1a4a8813eb97cbc5ee0f11b3977e4ecf78d449d257b57762b2` |

The explicit-column source query returned one read-only result. CSV and typed
JSON artifacts are kept outside Git with mode `0600`; the snapshot JSON hash is
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`. No raw
records are included in this document. The export excludes `system_settings`,
Auth, user rows, and Storage. Other tables that might be configuration remain
out until their user-data boundary and write behavior have been classified.

`fanmark_tier_extension_prices` is classified as non-user reference data and
has a versioned D1 schema and Worker read projection in migration
`0006_reference_master_extension_prices.sql`. The first active remote release
above contains only the first three tables; the current complete release is
recorded below.

## Latest remote release (2026-09-25 JST)

A fresh, explicit-column, read-only Supabase query captured all four allowlisted
reference masters. The private snapshot is outside Git with mode `0600`; its
SHA-256 and active release version are
`49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`. It
contains 29 rows: 4 tiers, 4 languages, 5 reserved patterns, and 16 extension
prices. The extension rows cover four tiers and 1, 2, 3, and 6 month terms,
with no duplicate tier/term keys. All 16 are active. Stripe Price ID values
were kept in the private snapshot and staging D1 only; the read API excludes
them. Format checks passed, but the IDs were not verified against Stripe's
objects.

The remote importer staged the release, compared each staged table and the
active views against the private snapshot, and promoted it to active generation
2. It confirmed all seven user-owned Auth tables remained empty and the
existing emoji release pointer/history remained unchanged. The live Worker
returned all four masters as HTTP 200 with `Cache-Control: no-store`; the
extension-price response contained the 16 public fields and no Stripe IDs.
The staging `AdminTierExtensionPrices` selector now reads and writes through
the versioned D1 admin API; at this 2026-09-25 checkpoint, an authenticated edit
had not yet been run. Checkout
and extension flows still use Supabase until their Edge Function secrets and
selectors move with the same active release. No user rows, Storage objects,
production service, or domain/DNS settings were changed.

`workers/api/migrations/0004_reference_master_releases.sql` creates immutable,
versioned staging tables, manifest hashes, a ready-state guard, a singleton
active pointer with append-only activation history, and active views named
`fanmark_tiers`, `languages`, and `reserved_emoji_patterns`. Migration
`0006_reference_master_extension_prices.sql` adds extension-price rows and a
fourth active view under the same release pointer. Staging does not change
active views. Promotion exposes a complete release through one D1 pointer
change after its row counts and table set pass readiness checks. A retry can
replace only a partial `loading` release; a `ready` release cannot be changed.

`monthly_price_usd` is PostgreSQL `numeric(10,2)`. The importer parses its
canonical two-place decimal text into integer cents without binary floating
point. The target view exposes that column in cents, matching the D1
availability repository codec; API boundaries convert cents back to USD.
Values are preserved; this conversion does not revise the configured prices.

Local verification on Node 22.6.0:

```sh
cd workers/api
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node test/reference-master-release.integration.mjs
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node --check ../../scripts/migration/reference-master-release-remote.mjs
```

The Miniflare tests cover exact money conversion, interrupted staging and safe
retry, ready-release immutability, no visibility before activation, active-view
readback, activation audit, and a SQL artifact generated from the source-shaped
snapshot. `scripts/migration/reference-master-release-remote.mjs` checks the
Cloudflare account/database identity, migration ledger, empty user-owned Auth
tables, emoji release immutability, exact staged readback, and optionally
activates the release.

Separately, Wrangler local D1 applied all five migrations (`0000`–`0004`) using
the app-staging migration pattern. The generated SQL artifact then loaded the
real source snapshot into that temporary local database. An independent
read-only SQLite comparison matched every staged row and active-view row, the
three source hashes/counts, activation generation 1, and the `0004` migration
ledger. Results were exact for 4 tiers, 4 languages, and 5 reserved patterns.
This tests the rendered source data and Wrangler migration parser locally; it
does not prove remote D1 access or remote import.

Remote result on 2026-09-23 JST: Wrangler read/write access to the intended
APAC staging database recovered after an earlier error 7403. Migration `0004`
was applied with the private SQL artifact (34 statements); `d1_migrations`
now contains `0000`–`0004`. The private snapshot was staged as release
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`; remote
readback verified 4 tiers, 4 languages, and 5 reserved patterns against the
source rows and hashes. The release was activated at generation 1, and the
active views were re-read and matched exactly. The remote guard confirmed all
8 Auth schema tables exist with zero user-owned rows, and the emoji active
release and activation history were unchanged.

The first post-promotion check rejected rows because it compared JSON object
property order. The values and counts were intact; the row comparator now sorts
keys before comparing, has a regression test, and the remote import script was
rerun idempotently to verify the active views and generation 1. See
[`live-observations.md`](live-observations.md) for the app-staging deployment
and HTTP readback. The source snapshot and row contents remain outside Git.

## Worker read API

`workers/api/src/reference-master-d1-repository.ts` exposes only four
allowlisted active masters at `GET /api/reference-masters/{name}`. Each query
joins the active pointer, a `ready` release, its table manifest, and rows bound
to that release version; row count and every returned field are checked before
serialization. The response contains a versioned minimal projection, uses
`Cache-Control: no-store`, requires no user session, and never reads
user-owned tables. Tier prices are named and returned as exact integer cents.
Unknown routes and backend values fail closed.

`useLanguages` can opt into this API with
`VITE_LANGUAGE_READ_BACKEND=worker`; the default remains Supabase. The Worker
client uses the explicit API base or the current same-origin Worker, validates
the release digest and strict language DTO, caps response bodies at 16 KiB,
and does not fall back to Supabase after a Worker failure. The staging build
uses this selector against its active reference release.

`AdminExtensionCoupons` can select `VITE_REFERENCE_MASTER_READ_BACKEND=worker`
to read tier labels and eligibility from the active release. A failed Worker
read disables new coupon creation; coupon writes remain on Supabase.
`AdminTierExtensionPrices` now has an opt-in Cloudflare staging path selected
by `VITE_REFERENCE_MASTER_ADMIN_BACKEND=d1`. The MFA-protected
`/api/admin/reference-masters/pricing` endpoint exposes Stripe IDs only to an
authorized admin session. Each single-field edit copies all four active
masters into a new immutable release, verifies D1 readback, and changes the
active pointer only if the screen's expected release is still current. Stale
screens get a conflict response, and API failures never fall back to Supabase.
At this earlier checkpoint the D1 admin implementation was locally tested and
its route code deployed, but the Worker and frontend selectors were unset in
staging. The later `Staging app wiring` section records the paired selectors
now active. The extension
display has its own opt-in `VITE_EXTENSION_PRICING_BACKEND=worker` selector. The two Supabase
Edge Functions can read prices from the same D1 release with
`REFERENCE_MASTER_PRICING_BACKEND=cloudflare`, `CLOUDFLARE_API_URL`, and the
Worker's `REFERENCE_MASTER_SERVICE_SECRET`. The private HMAC route has no CORS
or public fallback, rejects browser Origin headers, and allows only a 60-second
timestamp window. The checkout function receives only the selected test/live
Price ID; direct coupon extension receives only price and active status. The
Edge Functions continue to authenticate users and mutate licenses in Supabase.
The service route is deployed and its Cloudflare secret is configured. A live
request through the Supabase Edge helper verified an active D1 row for tier 2,
month 1 in both checkout and price-only projections at the current release;
the Stripe ID was validated in memory but never printed. The Edge Function
secret and selectors are still unset, and no payment or Supabase Edge Function
was deployed, so current checkout and extension writes still use Supabase.
These switches must move together with the admin editor to keep amount, active
state, and Stripe ID on one release. The reserved-pattern API has no frontend
consumer yet. Local synthetic proof runs with
`npm --prefix workers/api run test:reference-master-api`,
`npm --prefix workers/api run test:reference-master-service`,
`npm run test:reference-master-admin-api`,
`npm run test:reference-master-api`, and `npm run test:cloudflare-reference-master`.

The private route deployment was version `763c798c-8e37-456b-a720-54f75be1270b`;
the staging secret change is active as version
`04c062e3-15a2-40d6-aef5-4cce5340879e`. Live readback returned public extension
prices with 16 rows and no Stripe IDs, rejected an unsigned private request
with 401, and accepted the signed Edge helper requests without returning a
Stripe ID to the coupon path. Root stayed `noindex`, Auth health stayed 200,
and no user/Auth rows, D1 schema, Storage object, Stripe resource, production
service, or domain/DNS state was changed.


## Staging app wiring (2026-09-26 JST)

The workers.dev staging app now builds with the Worker extension-price read selector, the versioned D1 admin editor selector, and the Worker extension-checkout client selector together. The app Worker selects the D1 admin API, which retains its Better Auth admin and verified same-session MFA gate. The checkout client cannot invoke the Supabase Edge Function as fallback.

Live readback returned the existing 16-row extension-price projection under active release `49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`; the public DTO has no Stripe IDs. Anonymous admin access returned 401. At this 2026-09-26 checkpoint, no authenticated edit had been made, so the release content and pointer remained unchanged. Stripe checkout remains unavailable: the server selector, webhook/dispatch selectors, and Stripe secrets are unset, and the Worker route returns 404. No payment was attempted. Production and Supabase defaults, legacy coupon/direct-extension functions, user data, and domain/DNS remain unchanged.

## Authenticated Tier editor round-trip (2026-09-27 JST)

The deployed workers.dev staging admin API was exercised with a synthetic
Better Auth administrator whose same-session TOTP assurance was verified. The
preflight required empty Auth tables, zero business fanmarks/licenses, the
expected active Tier C value (`initial_license_days = null`), and the expected
29-row release shape (4 tiers, 4 languages, 5 reserved patterns, 16 extension
prices).

The canary changed only Tier C from null to one day, read back the new version
and all four release tables, rejected an anonymous write with 401, and rejected
a stale-release write with 409 without changing the active pointer. It then
restored Tier C to null through the same MFA-protected API. A canonical
comparison of all four tables matched the pre-canary values after restoration;
the two canary runs retained four immutable staging promotions in activation
history. The active reference release is generation 6 at
`d539bd5502a1bf115d2718d69bc8f9d27edcc4c5e9fdd269ba2746055127d2b4`.

The first canary run exposed that its new flag was not included in the script's
synthetic target-user cleanup condition. The remaining `example.invalid`
synthetic identity and profile were identified by exact ID and removed; readback
confirmed zero Auth users, accounts, sessions, verifications, factors, roles,
assurances, status audits, business profiles, fanmarks, and licenses. The
cleanup condition was corrected, and a second live run completed with the same
zero-row cleanup proof. The retained MFA generation singleton is monotonic.

Local validation passed: Worker reference-master API tests 6/6, Worker
reference-master service tests 5/5, frontend admin client tests 6/6, Node 22.6
syntax check, and `git diff --check`. The smoke command was
`node test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --reference-master-tier-roundtrip`.
The two canary edits advanced only staging Master D1 release history; no
Supabase row, production resource, Stripe resource, user-owned record, or
domain/DNS setting was changed. Browser interaction with the admin editor,
payment processing, and production selector changes remain unverified.
