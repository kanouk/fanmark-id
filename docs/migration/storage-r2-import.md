# Offline Storage to R2 import core

This slice copies a completed local Supabase Storage export into an explicitly
injected R2 binding-compatible transport. It is a reusable, offline-tested
core; it is not a production uploader and does not choose credentials, a
remote bucket, or a cutover time.

The input must be a private export produced by
[`storage-export.mjs`](../../scripts/migration/storage-export.mjs) and accepted
by [`storage-verify.mjs`](../../scripts/migration/storage-verify.mjs). The
verifier rechecks the manifest, complete export status, private file modes,
path containment, byte lengths, and SHA-256 values before the importer makes
any R2 call. The importer accepts only the allowlisted source buckets already
defined by the export contract (`avatars` and `cover-images`).

## Deterministic object mapping

Each source object maps to the exact R2 key:

```text
<source bucket>/<source object key>
```

The bucket prefix keeps equal object keys in different source buckets
distinct. Keys are validated before any write, are not normalized or
truncated, and must fit R2's 1,024-byte UTF-8 key limit. A key that does not
fit fails the object and cannot be silently relocated. The importer stores the
source bucket, source key, source size, source SHA-256, and optional source
content type as custom metadata; the source identity and content hash are
also checked during readback.

## Copy and readback protocol

For each object, the core:

1. Reads the existing target with `get`. An existing object is accepted only
   after its body is streamed, hashed, and compared with the verified source
   size and SHA-256, and its key, HTTP content type, and source custom metadata
   match. A metadata SHA-256 is not treated as proof of the body. Metadata or
   body mismatch fails without overwrite or delete.
2. Opens the verified local source file and streams bounded chunks with
   backpressure while checking its final size and SHA-256.
3. Uses `put` with `onlyIf: { etagDoesNotMatch: "*" }`. If R2 returns `null`,
   another writer won the conditional create; the core reads the target again
   and accepts it only if the complete readback matches. It never overwrites
   or deletes a conflicting winner.
4. Reads the newly written target again and requires the same full readback
   proof before marking the object verified.

The default source chunk is 64 KiB and is bounded to 1 MiB. The default
per-object limit is 100 MiB, with a 5 GiB maximum option. Source streaming and each provider operation have bounded deadlines; the
GET and body readback phases share one deadline for that readback. A new
operation receives a new deadline, rather than one deadline covering the
entire object copy. Timeout
and failure paths cancel or abort streams on a best-effort bounded wait; an
uncertain write is left in place for readback and is never removed by this
core.

The normal transport shape is `get(key)` and `put(key, stream, options)`. A
runtime that requires an explicit content length may provide the optional
`putWithSize(key, stream, options, size)` adapter. The local Worker proof uses
the request `Content-Length` and a Worker-side `FixedLengthStream(size)` before
calling the native binding. This keeps the file stream bounded and avoids
buffering the whole object merely to provide a length.

In the tested Miniflare path, passing a direct Node-side `ReadableStream` to
`getR2Bucket().put` is rejected without a known length, so the native test uses
the known-length adapter and Worker-side bridge described above. A later
runtime-specific transport must preserve that explicit size contract.

The conditional-create behavior and `onlyIf` options follow Cloudflare's
[Workers R2 API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
The key and metadata bounds are documented in
[R2 limits](https://developers.cloudflare.com/r2/platform/limits/), and the
known-length adapter uses the documented
[FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/)
and [Request body stream](https://developers.cloudflare.com/workers/runtime-apis/request/)
interfaces.

## Private resumable report

The default report is `r2-import.status.json` beside the verified manifest. It
is mode `0600`, replaced through a same-directory temporary file, `fsync`, and
rename, and contains only manifest binding, object identity, status, attempt,
operation, and sanitized error-code fields. It does not contain source bytes,
provider payloads, credentials, or response bodies.

Failures persist `complete: false` and a short error code. A later run can
resume, but a prior report is never authority for skipping an object: every
target, including objects previously marked verified, is read back again
against the currently injected binding. Completion is written only after all
objects have current readback proof.

The importer has no standalone network or credential mode. Its CLI help is
informational; a transport runner must be separately authorized and must
inject the selected R2 binding.

## Local validation

Use the repository's Node 22.6.0 runtime:

```sh
NODE22=/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node
PATH="$(dirname "$NODE22"):$PATH" "$NODE22" --check scripts/migration/storage-r2-import.mjs
PATH="$(dirname "$NODE22"):$PATH" "$NODE22" --test scripts/migration/test-storage-r2-import.mjs
"$NODE22" workers/api/test/storage-r2-import.integration.mjs
```

The focused core suite currently passes 14 tests. It covers empty, multichunk,
Unicode, key collision, truncation, matching and conflicting existing objects,
conditional-create races, report resume, metadata absence, option bounds,
provider/get/readback timeouts, locked-reader cancellation, and the injected
known-length transport timeout.

The explicit Miniflare integration uses the locally installed R2 binding and
passes the native stream, metadata/hash readback, a 16 MiB conditional bridge
race, and no-overwrite checks. The native local provider consumes the body
before returning its conditional `null`; the bridge therefore proves bounded
settlement and no overwrite for a fully consumed conflict, while its abort
path remains available for providers that return earlier. This test is
intentionally outside the default Vitest glob and must be run only with the
local Node 22 runtime and installed `workers/api` dependencies. It uses
loopback HTTP only and makes no external network request.

## Remaining migration gates

This evidence does not establish that a production R2 bucket exists, that its
binding and permissions are configured, or that the export directory is a
current source snapshot. A later reviewed runner still needs operator-selected
remote transport authorization, bucket/provisioning and access checks, the
actual verified export, upload execution, and independent post-upload
readback. URL or custom-domain cutover is a separate gate. No production
upload, source-row export, credential handling, or deployment is performed by
this slice.
