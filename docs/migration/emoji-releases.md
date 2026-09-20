# Versioned emoji catalog artifacts

The local release builder prepares the immutable artifact boundary for #36.
It does not import D1 rows, edit the administrator UI, upload to R2, activate a
public version, or change existing frontend lookup behavior.

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
verifiable after a new one is built, so its bytes are available for a future
rollback. No live rollback or active-version pointer exists yet.

Validation: `npm run test:emoji-catalog` covers generator input boundaries,
identity preservation, version reuse, row-order independence, mixed-file
rejection, old-version preservation, and failed identity review. These are
local artifact checks. Remaining #36 gates include D1 staging/import and
reference reconciliation, administrator authorization, version selection by
API/frontend, publish/rollback transactions, and production observation.

## Read-only source verification (2026-09-21)

The builder was also run against a fresh, paginated read of the live
`emoji_master` public catalog columns. Every source UUID/emoji/codepoint mapping
matched the verified release, and a second complete source read matched the
first. Credentials remained in process memory and artifacts remained in a
private temporary directory. This proves the observed catalog can pass the
initial artifact path; it is not a transactional snapshot, D1 import, or
publication of that version.
