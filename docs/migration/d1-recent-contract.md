# Local D1 recent-list contract

This document records the bounded D1 proof for the existing
`GET /api/fanmarks/recent` route. It adds a D1 repository behind the current
repository interface; it does not change the default source, create a remote
database, or claim that the migration schema is complete.

## Source selection

The Worker keeps Supabase as the default source. An environment must opt into
D1 explicitly with:

```text
RECENT_FANMARKS_BACKEND=d1
FANMARK_DB=<D1 binding>
```

The value is case-sensitive. An unknown non-empty value returns
`server_misconfigured`. `d1` without `FANMARK_DB` also returns
`server_misconfigured`; the Worker never falls back to Supabase after an
explicit D1 selection. A blank or whitespace-only value is treated as unset and
keeps the Supabase default. The production-preparation Wrangler file contains no D1
binding and leaves `RECENT_FANMARKS_BACKEND` unset, so its default behavior
remains the existing Supabase adapter. The synthetic binding lives only in
`workers/api/wrangler.d1-test.jsonc`, which is selected by the dedicated D1
Vitest config.

## Query and response contract

The D1 adapter in `workers/api/src/d1-repository.ts` mirrors the current
read-only source view observed in the migration metadata:

```sql
SELECT
  fl.id AS license_id,
  fl.fanmark_id AS fanmark_id,
  f.short_id AS fanmark_short_id,
  fl.display_fanmark AS display_emoji,
  fl.created_at AS license_created_at
FROM fanmark_licenses AS fl
JOIN fanmarks AS f ON f.id = fl.fanmark_id
WHERE fl.status = 'active'
ORDER BY fl.created_at DESC
LIMIT ?
```

The current live metadata readback is the authority for this bounded proof. A
checked-in schema snapshot contains an older projection using fanmark
normalized/input fields; that drift is recorded as a full-schema migration gate
and is not silently resolved by this fixture.

The limit is validated by the API as an integer from `1` through `20` and is
bound to the final `?`. The adapter repeats this range check as a defensive
boundary. The projection preserves the license UUID, the license's
`display_fanmark` value, and the stored timestamp string. The API maps these
fields to `id`, `emoji`, and `createdAt`; a null or empty display value becomes
`❓`, matching the existing Supabase path.

Only license status is filtered. A license whose `license_end` is in the past
still appears when its status is `active`; a `grace` or `expired` license does
not. The join omits an active license with no matching fanmark. Fanmark status
is not filtered. Equal timestamps have no defined tie order. Timestamp values
are returned as stored text, including subsecond precision; the repository does
not pass them through `Date`.

## Local fixture boundary

`workers/api/test/fixtures/d1-recent-contract.sql` defines only the
columns needed for this read proof: the fanmark ID, short ID, decoy normalized
and user-input values, fanmark status, license ID, display value, license
status, license end, and creation timestamp. It is deliberately not a partial
production schema and must not be used as a deployment migration. Full schema
conversion, constraints, indexes, row import, and remote D1 provisioning
remain separate migration gates.

The fixture varies license and fanmark statuses, includes an expired-but-active
license, leaves one active license orphaned for join behavior, and gives one
row a null display value. The normalized and user-input values differ from the
display value to ensure the D1 query preserves the live `display_fanmark`
column rather than deriving a replacement. Two rows differ only in the final
microsecond so ordering and exact timestamp preservation are exercised.

## Evidence

From `workers/api`:

```sh
npm run typecheck
npm test
npm run test:d1
```

The dedicated D1 run uses the real Workers test runtime and its synthetic D1
binding; the default `npm test` run uses the production-preparation config and
continues to exercise the Supabase-default route. The D1 entrypoint tests cover
the six joined active rows, status filtering,
expired-but-active inclusion, orphan omission, null-display fallback, exact
microsecond ordering/output, limit binding, unspecified tie ordering, explicit
source selection, fail-closed missing/unknown configuration, and sanitized D1
SQL failure. The existing Supabase API tests continue to cover the default
source and the static-assets suite remains a separate test command.

This evidence is local only. It does not establish remote D1 provisioning,
production bindings, CPU or concurrency limits, the full schema/data import,
frontend source selection, or OAuth/authentication behavior.
