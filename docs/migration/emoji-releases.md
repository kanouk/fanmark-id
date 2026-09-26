# Versioned emoji catalog artifacts

The local release builder prepares the immutable artifact boundary for #36.
Verified releases can be staged and activated in local D1. A read-only Worker
route now serves the active release and an opt-in frontend build loads it before
rendering. This code does not edit the administrator UI, upload to R2, or
deploy a Worker. An isolated remote D1 now holds the verified public emoji
master and its active release; the workers.dev staging API serves it by default.
Production application routing and custom-domain cutover remain separate gates.

## Cloudflare staging のマスター編集

`AdminEmojiMaster`はCloudflare staging modeで`/api/admin/emoji-master`へ接続し、
Better Authのadmin roleと同一session/factorに結び付いた期限内MFA assuranceを
Worker側で毎回確認する。読み書き先は`MASTER_DB`のcanonical `emoji_master`
だけで、public APIが読むactive release stagingとは別である。追加、編集、
CSV/JSONインポートは未公開draftを更新する。インポートは同一絵文字をupsertし、
既存UUIDを維持する。古い画面からの上書きは`updated_at`比較で拒否される。

ready releaseのいずれかに含まれるUUIDは、UUID・絵文字・コードポイントの
変更をSQLite triggerでも拒否する。削除はAPI・UIの両方で拒否し、公開履歴と
参照先の別レビューを必要とする。canonical draftを変えてもactive pointerと
公開releaseの内容は変わらない。新しい公開版は成果物作成、identity continuity
照合、remote readback、明示的activationの既存release手順を経る。

ローカル検証では認証なし/MFA不足、session束縛、create/update/import、CAS競合、
公開identity拒否、削除拒否をMiniflareで確認し、draft変更後もactive APIが元の
release内容を返す。staging配備・ライブ認証確認はHANDOFFとlive observationsに
別途記録する。管理画面のデプロイだけでは公開カタログの変更を意味しない。

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
Local D1 promotion/rollback and its audit pointer are described below. The
remote staging API currently serves the verified catalog at activation
generation 3 after the staging rollback rehearsal recorded below.
The first pointer cannot be reset to an inactive state; after a later version is
promoted, the normal guarded rollback can return to this version. The remote
activation runner accepts `--action promotion` (the default) or
`--action rollback`. Rollback requires the immutable artifact directory for a
previously active release and the exact current version in `--expected-active`;
the destination re-verifies both stored releases, identity continuity, the
generation-checked pointer, and the appended activation-history row. Stale
expected versions fail before changing the pointer, including when a promotion
would otherwise be an idempotent no-op.

Validation: `npm run test:emoji-catalog` covers generator input boundaries,
identity preservation, version reuse, row-order independence, mixed-file
rejection, old-version preservation, and failed identity review. These are
local artifact checks. Remaining gates include administrator authorization,
reference-aware release and rollback review, and production observation.
Remote D1 staging and activation now precede the integrated #37 rehearsal, per
the updated migration order. The active release is confined to the
workers.dev staging API; production application routing, user data, and DNS
remain reserved for the final #38 gate.

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

## Remote APAC D1 master staging (2026-09-23)

The user moved explicitly approved master data ahead of the real user-data and
domain cutover stages. Wrangler verified the intended Cloudflare account, then
created the isolated `fanmark-emoji-master-staging` database in APAC. It is not
bound to the default Worker config. The migration-only
`workers/api/wrangler.emoji-staging.jsonc` has no Worker entrypoint and selects
migrations `0000` through `0006`. `0000_emoji_master.sql` creates the
canonical table with PostgreSQL arrays represented as JSON arrays; `0001` and
`0002` add private release staging and an inactive promotion pointer. The
master D1 also includes `0003_better_auth_core.sql` and reference/admin
extensions `0004` through `0006` used by the staging app and master APIs.

The remote staging command verified the account/database identity, re-verified
the immutable artifact, appended the 3,944 public records to canonical
`emoji_master`, staged a separate version, then compared every row after
readback. A second independent remote readback matched both artifact hashes:
`recordsSHA256` is
`84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`, and
`identitySHA256` is
`dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`.
Pinned-runtime release
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed` contains
3,944 rows and is `ready`. The active pointer and activation history both
remain empty. An initial build from the shell's Node 25 runtime produced a
different module hash despite the same record/identity hashes. Node 22.6.0
rejected that artifact during verification, so its remote release was marked
`failed` and its 3,944 staging rows were removed; only its failure metadata is
retained. At the end of this initial staging step, no real users, user-owned
data, public catalog switch, Supabase write, or DNS change had occurred. Both
the read-only catalog Worker and the SPA/API
staging Worker are deployed on `workers.dev`; the SPA Worker reads this release
by its immutable version. The active pointer remains unset.

Wrangler's remote migration parser rejected the existing nested `CASE ... END`
guards in migration `0002` as incomplete SQL. Those trigger guards now use
equivalent conditional `RAISE ... WHERE` statements; the seven-case local
release integration suite passes. The standard remote `migrations apply` query
path also returned `incomplete input` for `0003`; the same file succeeded in
local D1. It was then applied to the isolated remote D1 through Wrangler's
transactional `--file` import path with the standard `d1_migrations` record.
Remote readback confirms all eight Auth tables, six generation triggers, the
singleton MFA generation row, and no remaining user/account/session/factor
rows. `d1 migrations list` reports no pending migrations.

## Remote promotion and rollback rehearsal (2026-09-25 JST)

The guarded remote activation runner was exercised against the isolated
`fanmark-emoji-master-staging` D1. A temporary immutable 3,944-row release was
built from the verified active artifact with one staging-only keyword marker;
all UUID/emoji/codepoint identities remained identical. It was staged without
writing the canonical `emoji_master` table, then promoted with the exact
expected active version. The previous verified release was immediately
restored through `--action rollback`, again with the exact expected-active
version. Both operations read back their generation and immutable history rows.

The pointer is back on release
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed` at
generation 3. The app catalog API returns HTTP 200, that version, and 3,944
rows; the marker is absent from the active response. The temporary rehearsal
release remains ready but inactive because its activation history is immutable.
Canonical `emoji_master` remains at 3,944 rows. The emoji-only Wrangler config
now includes migrations `0000` through `0006`, all of which are present in the
remote ledger; Wrangler reports no pending migrations. No user data, Auth rows,
production service, or domain/DNS state was changed. Node 22.6.0 checks passed:
`npm run test:migration-data` (93/93),
`npm --prefix workers/api run test:emoji-master-release` (7/7), CI isolation,
and `git diff --check`.

## Remote staging activation and API readback (2026-09-23)

The remote re-staging guard now accepts the applied, empty Better Auth schema,
requires all four migration ledger entries, and verifies that the active pointer
and activation history do not change while a release is staged. Its repeat run
reused the same `ready` release: canonical master 3,944 rows, release 3,944
rows, active pointer 0 before activation, history 0, and all eight Auth tables
present with user-owned Auth rows at 0. Tests cover missing schema, any Auth
rows, changed MFA generation, and activation-state mutation.

The remote activation command required the expected active state to be `none`,
re-verified the artifact and every staged row, and promoted version
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`. Readback
shows generation 1 and one immutable activation event. The dedicated
workers.dev catalog API changed from 503 while inactive to 200. A full eight-page
fetch returned all 3,944 rows; the release version, `recordsSHA256`, and
`identitySHA256` matched the independently verified artifact. Better Auth
user-owned rows remain at 0. No production Worker, user data, Supabase write,
R2 bucket/object, or custom domain/DNS was changed.

## Independent acceptance review (2026-09-26 JST)

Astra re-ran the release builder checks (7/7), Worker release-stage and
promotion/rollback integration (7/7), version-pinned catalog API integration
(3/3), and the emoji-master admin client contract (4/4). Together these cover
UUID and codepoint identity preservation, duplicate/collision rejection,
interrupted import remaining unpublished and safe retry, immutable ready
releases, page consistency across active-version changes, guarded promotion,
rollback, and stale-version rejection.

A fresh read-only pagination of the deployed master catalog API returned all
3,944 rows from release
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`; all
3,944 IDs were unique and page version/offset/total metadata stayed consistent.
The staging rollback rehearsal remains the operational evidence; this review
performed no D1 writes or activation. The migration stage is complete for the
isolated master D1 and workers.dev distribution path. Production API routing,
custom domains/DNS, and user-data migration remain later stages.
