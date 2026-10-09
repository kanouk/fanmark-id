# Supabase Storage export preparation

This is a read-only preparation tool for the current Supabase Storage media. It
lists and downloads the allowlisted `avatars` and `cover-images` buckets into a
new local directory so the files can be inspected before any later migration
decision. It does not write to Supabase, upload to R2, change database rows, or
change the URLs used by the application.

The current baseline identifies these buckets as user media. The tool is
deliberately limited to them; an unknown bucket is rejected rather than being
accepted through a typo or a broad service-key query.

## Run locally

Keep the service key in the process environment. Do not place it in a command
file, output directory, manifest, or issue comment. The command expects an
empty output directory and never resumes a partial export:

```sh
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="(read from your secret store)" \
  node scripts/migration/storage-export.mjs \
  --output-dir "/private/path/fanmark-storage-export"
```

The key is used only for authenticated Storage REST requests. The tool sends
`Authorization: Bearer ...` and `apikey` headers, but it never prints either
header or the key. Shell history and process-environment handling still belong
to the operator.

Useful options are:

```sh
node scripts/migration/storage-export.mjs --help
node scripts/migration/storage-export.mjs \
  --output-dir "/private/path/fanmark-storage-export" \
  --buckets avatars \
  --concurrency 4 \
  --max-bytes 52428800 \
  --timeout-ms 30000
```

`--buckets` is a comma-separated subset of the two allowlisted buckets.
Downloads are bounded to four concurrent objects by default and eight at most.
Each list or download request has a timeout, object bodies are streamed through
the per-object byte cap, and redirects are rejected. Listing walks nested
prefixes and paginates at 1,000 entries. Duplicate object identities,
traversal-shaped keys, malformed responses, and unsafe limits fail the export.
The inventory is capped at 100,000 objects so a listing that never reaches an
end cannot consume unbounded local storage or requests.

The export performs a complete inventory before downloading and again after all
downloads. A changed object id, key, metadata, or update timestamp makes the
run fail. This is a before/after observation, not a transactional Supabase
snapshot; objects can still change outside the two list calls.

## Output and failure state

The output directory is created with mode `0700`; its `objects/` directory is
also `0700`. Each downloaded file is named with
`SHA-256(bucket + "/" + key)` and has mode `0600`, so local filenames do not
reveal Storage keys. The directory contains:

```text
export.status.json  # private progress or failure state
manifest.json       # present only after a complete export
objects/<sha256>    # private downloaded bytes
```

`manifest.json` is written to a private temporary file and renamed only after
the post-download inventory matches the pre-download inventory. It records
`schemaVersion`, `complete`, the selected buckets, object count, and
`inventory` with `stable`, `beforeSHA256`, and `afterSHA256`. Each object entry
records `bucket`, `key`, `size`, `contentSHA256`, the source `metadata`, and its
hashed `localFile`. The temporary file and final rename are on the same output
filesystem; this gives a replacement-style atomic rename, not an `fsync` or
durable backup guarantee.

`export.status.json` starts as `in_progress` and is replaced atomically as the
run advances. A successful status records `complete`, the object count, and
the same stable inventory hashes as the manifest. A failure leaves partial
files for diagnosis, removes a manifest written during the failing process,
and attempts to record a short error code without source keys, response bodies,
or credentials. If the filesystem cannot write the status, the command reports
the failure but cannot manufacture a status file. There is no resume claim: use
a fresh empty output directory for the next attempt.

There is a small process-crash window between the atomic manifest rename and
the final complete status rename. In that case the manifest may exist while
the status remains `in_progress`; the verifier rejects that directory. A
manifest is therefore accepted only when both files independently say the
export is complete and their object count and inventory claims agree.

Verify the local result without any network access:

```sh
node scripts/migration/storage-verify.mjs \
  "/private/path/fanmark-storage-export/manifest.json"
```

Verification checks private non-symlink manifest/status files and export
directories, rejects an `objects/` directory outside the output root, checks
hashed path containment, file mode, file size, content SHA-256, and
`metadata.size` when present. It also checks the complete status and stable
before/after inventory claim. It does not re-contact Supabase or prove source
content after the recorded inventory.

## Offline checks and migration boundary

The focused fixture suite uses an injected local `fetch` implementation and
never needs a Supabase key or remote request:

```sh
node --test scripts/migration/test-storage-export.mjs
```

It covers nested pagination, duplicate and traversal identities, metadata and
inventory changes, byte caps, response and body read failures, timeout before
headers and after headers, redirect rejection, hashed path containment,
manifest/status invariants, private modes, and symlinked roots.

This tool prepares evidence for review. It does not claim a production backup,
an R2 upload, a database cutover, or parity for every future Storage bucket.
Supabase's current REST and client download behavior is documented in
[download objects](https://supabase.com/docs/guides/storage/management/download-objects),
[serving assets](https://supabase.com/docs/guides/storage/serving/downloads), and
[the Storage quickstart](https://supabase.com/docs/guides/storage/quickstart).

## Read-only live verification (2026-09-21)

The reusable exporter completed against both allowlisted source buckets. The
independent local verifier then checked all downloaded sizes, SHA-256 hashes,
private file modes, and complete manifest/status agreement. Credentials stayed
in process memory; private manifests and source object paths were not committed.
The pre/post inventory matched. This remains a temporary local observation,
not a transactional cutover snapshot, durable backup, or R2 upload.
## Runtime verification

Use the repository's `.node-version` (22.6.0) for validation. The verifier reads
files in bounded 64 KiB chunks and owns each file handle's close operation.
This avoids a reproduced Node 22.6 native abort when `readableWebStream()`
completion races with an explicit close. Empty files, multiple chunks, and
same-size corruption in the final partial chunk are covered by the tests.
