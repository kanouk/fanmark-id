## Current capacity acceptance (2026-10-13)

Sourceef2128f/CI38372438870 passes both jobs. Actual Cloudflare Worker/Better Auth,
all27 Business/4 Auth/8 Master schemas and real reference-release/emoji activation
accept eight capacity cases, including direct Free refusal, one-slot concurrency,
Admin, perpetual Tier C and changed configuration with safe retry. All owned
Worker/3D1 resources are removed and independently checked. Normal5e78343b
preserves binding114, all3 D1 schema/counts/FK0, ten assets, catalog and backup/monitor,
with independent readonly readback. Frontend/schema/normal DB writes/secrets and
real-user/domain changes are0. [Scoped proof](evidence/acquisition-lottery-capacity-native-2026-10-13.json).

# Fanmark registration Worker API

## Route and selection

`POST /api/fanmarks/register` implements the existing `register-fanmark` Edge
Function operation against the business D1 database. Better Auth provides the
owner ID; the request never accepts a user ID. The route reads emoji identity
and tier data from Master D1, and writes the fanmark, initial license,
license-scoped settings/profile, and audit row in one business-D1 batch.

Business migration `0022_fanmark_discovery_link.sql` preserves the source
AFTER INSERT discovery linkage for every fanmark writer, including trusted
SQL. It compares ordered UUID values, canonicalizes their case, omits NULL
array elements and ignores JSON formatting, matching typed source UUID-array
identity semantics without reproducing MD5 hash collisions. It updates the
matching discovery and all its favorites in the parent transaction. Display,
created/seen timestamps and counters are retained. More than one semantic
match, rejected updates or silently suppressed required updates abort the
entire insertion. Existing-row reacquisition stays outside this INSERT trigger,
as it does in the source. This does not backfill old user-owned rows.

Emoji rows are read from the ready active catalog release (not the mutable draft
table), and tiers are read from the active reference-master view.

The normal frontend defaults to the Supabase Edge Function. An explicit
`VITE_FANMARK_REGISTRATION_BACKEND=worker` build selects the Worker client;
the matching Worker switch is `FANMARK_REGISTRATION_BACKEND=d1`. A failed
Worker request never falls back to Supabase. The Cloudflare staging build and
Worker config select the new path; production builds retain the Supabase
default.

## Input and identity rules

Cloudflare registration enforces the PRODUCT plan limit on the server, including
direct HTTP requests that bypass the frontend's disabled button. The limit comes
from the authenticated user's Business profile and the corresponding setting;
missing settings use Free3/Creator10/Max500/Business50/Enterprise100, and Admin is
unlimited. Missing/ambiguous profiles and malformed limits fail closed.
Active licenses with a future or NULL end count toward capacity; expired ends
and foreign owners do not. A first assertion in the same Business D1 batch
rechecks current capacity and the exact profile-plan/setting snapshot, so a
competing acquisition or plan edit rolls back identity, license, config and audit
writes. The API returns403 `fanmark_limit_exceeded`,409 `plan_limit_changed` for a
changed snapshot that still has capacity, or503 for unavailable configuration.
Mutations are not automatically resent. This deliberately fixes a source Edge
behavior that relied on the frontend's limit gate; the Supabase production path
is unchanged. Original availability, Tier and source pricing rules below remain.

The JSON body accepts `user_input_fanmark`, one to five ordered `emoji_ids`, an
optional matching `normalized_emoji_ids`, `accessType`, display/default names,
redirect URL, text content, and `createProfile`. Request bodies are capped at
24 KiB. IDs are resolved against the active Master D1 catalog. The server
verifies that the submitted emoji string matches the ordered catalog values,
removes skin-tone code points only when deriving canonical identity IDs, and
rejects a client-supplied normalized-ID list that differs from that derivation.
Tier classification preserves the source rules and reads the active tier row.
Availability and registration share `workers/api/src/fanmark-tier.ts`; the
[source-helper review](source-emoji-helpers-review.md) records the identity,
display and raw-text-counter boundaries.

An existing fanmark can be reused only while active and without an active
license, an unexpired grace license, or a pending lottery entry tied to an
expired grace license. Active license status blocks acquisition even if its
end timestamp has passed, matching the existing registration function. The
final D1 mutation repeats these checks so competing requests cannot both issue
an active license. A unique identity/short-ID failure or any dependent-write
failure rolls the whole batch back.

The product limit remains one to five emoji IDs. A valid over-five list
returns `invalid_emoji_count`; the public `system_settings.max_emoji_characters`
value can lower that limit, and a missing row defaults to five. Other private
settings are never read by this registration path.

The first license end uses the tier's `initial_license_days` and rounds up to
UTC midnight, matching `roundUpToNextUtcMidnight`. The response retains the
existing success/fanmark shape, including canonical and display URLs.

## Boundaries and proof

This operation does not call Stripe or send email. It preserves the current
Edge Function behavior for pattern pricing: the source registration function
does not reject `requiresPayment` results, so this adapter does not introduce a
new payment policy. Availability remains an advisory API and is not treated as
authorization for registration.

The local D1 integration suite uses synthetic identity/catalog rows and covers
21 cases: first registration, finite repeated-ID tiers, native-writer discovery linkage, all-owner favorites,
ordered/case/NULL/whitespace identity, ambiguous identity rejection, rejected
and suppressed link rollback/retry, skin-tone identity, reuse, stale normalized IDs, grace and
lottery conflicts, competing requests, dependent-write rollback, CORS, and
authentication result handling. The frontend client has separate selector,
cookie, no-store, error, and no-fallback tests. These tests do not prove source
data parity or production behavior. The staging canary must use a disposable
Better Auth identity, verify business D1 readback, and delete every synthetic
row before the route is considered staging-verified.

## Current-schema and session verification (2026-10-03 JST)

`npm run --prefix workers/api test:fanmark-registration-d1` runs the existing21
focused regressions plus5 new cases through handleRequest and real Better Auth
sign-in/session cookies. The new suite applies all25 Business/4 Auth/8 Master
migrations, uses immutable emoji release/activation tables and stages/activates
reference masters with the migration helper. fanmark_tiers is the actual view.
Local26/26, Worker typecheck and changed-file lint pass; all three D1 FK checks
are empty after each new case. All credentials/rows are synthetic and local.

New coverage: UUID case, tone display/identity, ordered/reversed IDs, actual
session owner despite an untrusted body actor, discovery/all-owner-favorite
linkage with retained times/counts, owner conflicts, S/A/C finite/unlimited
licenses and absent/revoked-session rejection. Suspension uses actual admin
sign-in, TOTP enrollment/challenge and the MFA-protected status route, confirms
session deletion and rejects the suspended user's old cookie. A bare SQL banned
flag retaining sessions is not substituted for the application's transaction.

Normal Worker npm test's test:api-contracts-d1 previously omitted registration;
it now runs this dedicated command. The new file is excluded from generic
Vitest so its required bindings/provision execute only under this config.
The older reduced suite remains useful for historical NULL/formatting and fault
regressions; it is not full-schema proof. Code/test head a2d09dd passes both jobs of
[CI37120631839](https://github.com/kanouk/fanmark-id/actions/runs/37120631839).
Its Worker job log confirms both test files ran and26/26 passed.

This slice changes tests/configuration only; no runtime/schema/deployment or
real provider/user/DNS change. [Sequence review](source-sequence-key-review.md)
records current-writer correspondence and final data-stage conditions. Broader
source/provider/operational/final integration remain open.


## Discovery-link staging acceptance (2026-10-03 JST)

CI `37035931199` passed code head `4279db0`. Business migration 0022/ledger
and its exact native trigger were applied/read back before Worker
`1eb5d9ac-815e-4957-8381-b6024dac33e8` was deployed at 100% on workers.dev.
The guarded synthetic canary seeded an unclaimed discovery and favorite,
signed in and registered the matching emoji. Discovery and favorite linked
to the new ID; counts/seen times/favorite display and creation time remained
unchanged. The favorites API returned that exact linked ID/status. The same
run passed registration/lottery/anonymous and authenticated details/R2 cover
checks. Scoped cleanup restored source-table/Auth emptiness and master
baselines; R2 cover readback was 404. The private journal ended
`verified-and-cleaned`. Runtime incarnation/MFA generations are retained.

```sh
FANMARK_EXPECTED_STAGING_VERSION=<verified-current-version> \
  node scripts/migration/staging-fanmark-registration-smoke.mjs \
  --run-live-staging-write --verify-discovery-link
```

The command verifies account/split bindings, the current 100% Worker version,
Business ledger and exact linkage trigger, empty Auth and source/master
baselines before writing. It stores only synthetic recovery metadata locally.
No source user row, real payment/email, production route or domain/DNS changes.
