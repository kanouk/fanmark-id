# Versioned emoji catalog artifacts

The local release builder prepares the immutable artifact boundary for #36.
Verified releases can be staged and activated in local D1. A read-only Worker
route now serves the active release and an opt-in frontend build loads it before
rendering. This local code does not edit the administrator UI, upload to R2,
mutate canonical `emoji_master`, or configure/deploy remote D1.

Use an authoritative database export with the UUID-bearing record format
specified in TECH.md. Unicode conversion output has no database UUIDs and is
not an initial migration source. JSON columns exported from D1 must first be
decoded into arrays. Run with the repository's pinned Node version:

```sh
node --experimental-strip-types scripts/build-emoji-release.ts \
  /private/path/emoji-records.json /private/path/emoji-releases
```

For an update, pass the previously accepted release directory as the third
argument. The first release has no prior identity comparison and must be
reconciled with live database UUIDs before acceptance. Subsequent release
review requires the previous directory; omission does not prove continuity.

Each completed version contains `records.json`, `emojiCatalog.ts`, and
`manifest.json`. The manifest binds the canonical source records, module
bytes, identity mapping, entry count, and schema version with SHA-256 hashes.
Its content hash is the version directory name. Only the explicit public
catalog columns are emitted; extra input fields are excluded. Input row order
does not affect the version. The generator's existing sort/lookup behavior is
retained; regeneration verification uses the pinned runtime and generator.

A previous release is verified before comparing IDs. All previous UUIDs must
remain and must still name exactly the same emoji and codepoint sequence.
Metadata changes and new UUIDs are allowed. A variation-selector correction
that changes an existing identity is therefore refused and needs a separate
reviewed migration, rather than silently breaking stored references.

Files are first written into a staging directory, read back, regenerated, and
verified. Only then is the directory renamed to its content version. An
existing version is verified and reused without rewriting it; incomplete or
modified versions fail. A failed build never activates anything. A process
crash may leave a `.staging-*` directory; consumers must never select it. The
local rename is not a claim of remote publication atomicity or fsync durability.

`verifyRelease(directory)` detects mixed versions, modified records/modules,
and inconsistent manifest fields. A valid old release remains independently
verifiable after a new one is built, so its bytes are available for rollback.
Local D1 promotion/rollback and its audit pointer are described below; no remote
pointer is configured.

Validation: `npm run test:emoji-catalog` covers generator input boundaries,
identity preservation, version reuse, row-order independence, mixed-file
rejection, old-version preservation, and failed identity review. These are
local artifact checks. Remaining #36 gates include remote staging under the
approved Cloudflare environment, administrator authorization,
reference-aware release and rollback review, and production observation.

## Isolated D1 staging (2026-09-23)

`workers/api/migrations/0001_emoji_master_release_staging.sql` adds private
release-import metadata and row staging tables. The new
`scripts/migration/emoji-master-release-stage.mjs` verifies the immutable local
release, checks source-shaped `emoji_master` UUID/emoji/codepoint continuity,
loads catalog rows in bounded D1 batches, reads them back, then marks that
version `ready`. A partial `loading` version is cleared and retried on the next
run. A ready version is immutable to this importer: mismatching readback quarantines
it as `failed` and fails closed.

The local integration proof uses Miniflare D1 and synthetic records. It checks
array encoding, identity conflicts, partial interruption/retry, version reuse,
and retention of two staged versions. It leaves canonical `emoji_master`
untouched; staging does not activate a public version, update API/frontend
selection, provide rollback, or run against remote D1. Run it with
`npm --prefix workers/api run test:emoji-master-release`.

## Local D1 activation and rollback (2026-09-23)

`workers/api/migrations/0002_emoji_master_release_activation.sql` adds a
singleton active-version pointer and immutable activation history. The local
activation helper re-derives the release hash from staged rows, checks them
against the immutable artifact, preserves all active UUID/emoji/codepoint
identities, and switches the pointer with a generation-checked write. Database
triggers keep ready rows and activation history immutable. Rollback only
targets a previously active version, and is refused if it would remove an
identity introduced since that version. The local API and frontend below read
this pointer; it is not a public release or remote activation.

## Local read-only API and frontend connection (2026-09-23)

`GET /api/emoji/catalog` reads only the active versioned staging tables through
the `FANMARK_DB` binding when `EMOJI_CATALOG_BACKEND=d1` is explicit. It returns
the public catalog fields, caps each response at 500 rows, validates row count
and ordinal continuity, and accepts an optional pinned version for later pages.
Missing active data fails closed; unknown backend configuration is a server
error. The route never reads browser credentials, user tables, or canonical
`emoji_master`.

When the frontend build sets `VITE_EMOJI_CATALOG_BACKEND=worker` and
`VITE_FANMARK_API_BASE_URL`, startup fetches all pages pinned to the first
response's version, verifies page shape and catalog identity uniqueness, then
installs synchronous conversion indexes before React renders. Requests omit
credentials and disable HTTP caching. An API, network, or integrity failure
shows a retry screen and does not fall back to Supabase or the bundled catalog.
Without the Worker selector, the existing generated catalog is loaded as a
separate startup chunk. The Worker-selected production build omits that chunk.

Validation: three Worker-entrypoint/D1 API tests, seven D1 release tests, five
frontend pagination/validation tests, one runtime conversion replacement test,
API and frontend typechecks, a Worker-selected Vite build, and the Worker dry
run passed locally. The default Worker deploy config still has no D1 binding;
the dry run lists only synthetic Supabase variables. No remote D1 or deployment
was changed, and the selected build has not been deployed or observed live.

## Read-only source verification (2026-09-21)

The builder was also run against a fresh, paginated read of the live
`emoji_master` public catalog columns. Every source UUID/emoji/codepoint mapping
matched the verified release, and a second complete source read matched the
first. Credentials remained in process memory and artifacts remained in a
private temporary directory. This proves the observed catalog can pass the
initial artifact path; it is not a transactional snapshot, D1 import, or
publication of that version.

## Live public catalog staged locally (2026-09-23)

Two independent read-only exports from the authenticated Supabase SQL Editor
selected only `id`, `emoji`, `short_name`, `keywords`, `category`,
`subcategory`, `codepoints`, and `sort_order`. Both contained 3,944 rows and
normalized to the same SHA-256:
`84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`.
Every UUID and emoji was unique. The immutable release version is
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`.

That release was staged into an ephemeral local Miniflare D1 database after
seeding a source-shaped canonical `emoji_master` fixture. All 3,944 canonical
rows and 3,944 separate staging rows read back, and every staged record matched
the verified release; the version reached `ready`. This validates the release
builder and staging path with the observed public master data. The Supabase
source was read-only; no remote D1, user rows, Auth data, production master
write, or public release was involved in that staging proof. The local
canonical table was only a fixture and was unchanged outside this disposable
database. The proof and related suites ran on the pinned Node 22.6.0. Private
export files remain outside the repository.
