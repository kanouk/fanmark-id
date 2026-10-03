# Isolated synthetic remote recovery

This rehearsal restores the checked-in synthetic Business fixture and its
Auth dependency user, emoji/reference masters and two PNG assets into fresh
Cloudflare resources. It never exports real users, credentials, Storage or
source business rows and does not change DNS or existing staging bindings.
It does not prove real-user identity/password migration, full source converter
acceptance, source-URL rewriting/browser display, or production RTO.

## Execution boundary

[`run-isolated-combined-recovery.mjs`](../../scripts/migration/run-isolated-combined-recovery.mjs)
requires an exact clean tested head (apart from the known Supabase CLI temp
file), a completed successful CI with both jobs and the combined-recovery
step successful, and the dedicated fanmark Wrangler account. Both application
and Worker dependencies must be installed with the project Node version.

```sh
node --experimental-strip-types scripts/migration/run-isolated-combined-recovery.mjs "$FANMARK_TESTED_HEAD" "$FANMARK_ACCEPTED_CI_RUN"
```

The staging config is used only to acquire and verify the dedicated account's
credential. Every later Wrangler child receives that credential through
`CLOUDFLARE_API_TOKEN`, including commands whose config lives in `/tmp`; no
profile is changed globally. A temporary-config `whoami` must include the
expected account before any resource is created. The explicit-token path was
verified with a real read-only CLI call; the token was neither printed nor saved.

Those variables must name this candidate's accepted head/run. An empty or
different head, pending/failed CI, or foreign account stops before resources
are created. The command is explicit; CI syntax-checks the conductor and runs
local transport/combined tests but never executes this remote command.

## Bundle and target ownership

The existing local rehearsal and the remote conductor share one fixture
builder. The snapshot contains 40 tables/15 synthetic rows; its manifest and
emoji/reference/Storage artifacts are bound into one SHA-256 bundle. The
remote command restores the same files into two separately created physical
targets/incarnations and compares all reconciled table counts/source hashes
and master/asset results. Auth restoration currently seeds the same synthetic
dependency user under four runtime migrations; it is not an Auth credential
backup/restore claim.

Each target owns three `fanmark-recovery-...-{business,auth,master}` D1
databases, two `...-{avatars,covers}` R2 buckets and one temporary recovery
Worker. Targets run sequentially and each is cleaned before the next begins.
Existing resources are not deleted to make quota space. Bootstrap applies
25 Business, 4 Auth and 8 Master migrations plus the retained Master Auth core.
Only fresh-target schema initialization is chunked; snapshot/checkpoint writes
use the original atomic D1 REST batch. Full DDL/profile verification precedes
snapshot rows. The primary run interrupts after a committed credential batch
and then resumes using the saved checkpoint; the second restores the same
bundle into a fresh incarnation. FK checks and the single notification wake
generation are read back.

Tokens stay in memory or are sent to Wrangler secret input over stdin. A
private temporary directory and mode-0600 atomic journal record creation
intents, exact D1 UUID/name/creation-time receipts, R2 name/creation-time
receipts, Worker deployment version, stages, reports and cleanup. On a failed
or unknown create/delete acknowledgement, use the existing journal to resolve
that exact resource before starting another run. Do not infer that a failed
command means no resource exists.

Cleanup verifies the owned image bodies, removes only the two exact fixture
keys and checks empty physical inventories. It preserves the Worker access
path if image cleanup fails. Worker deletion requires its recorded deployment
version and creation time; bucket/database deletion requires exact metadata
receipts. The final metadata inventories must match the originals. If deploy fails before a version receipt is available, cleanup independently
checks Worker metadata. It accepts absence only when the exact owned name is
absent; a remaining Worker without a receipt is unresolved and is not deleted
blindly. CLI failures retain the command, exit status, known signal and bounded
numeric provider codes only, never raw output or secret input. A failure
leaves the journal and reports available; it is not accepted as a clean restore.

## R2 transport and app readback

[`isolated-remote-r2.mjs`](../../scripts/migration/isolated-remote-r2.mjs) connects
only to the temporary recovery Worker family on the fanmark workers.dev
subdomain, with a private token, incarnation and expected recovery bucket names.
Loopback is permitted only explicitly in local tests. Private routes allow only
the two fixed synthetic owner keys. Conditional create uses `etagDoesNotMatch:*`
and a provider SHA-256 check; a losing writer returns null without overwrite.
The importer independently checks bytes, hash, MIME, size and source metadata.
HTTP GET may be chunked without Content-Length: provider metadata size and
measured body length remain required, and any supplied HTTP length must match.

The temporary Worker bundles the actual application `storage-r2.ts` public
GET/HEAD handler. The shared recovery checks read its HTTP routes and exact
physical inventories after import/replay. Source DB URLs still name the
synthetic Supabase origin; deriving the corresponding Storage API path for
this readback does not prove profile URL conversion or rendered browser use.

## Current proof

- Real isolated D1 REST primitive: candidate1d3085f/CI37108741104, value/NULL/
  int64 readback, CHECK rollback, deliberate success-response loss without
  automatic write retry, owned resource deletion and original inventory equality.
- Shared local combined regression: 40 tables/15 rows, two targets, Master/R2
  and actual app GET/HEAD, all accepted. Latest fresh local restore10393ms.
- New HTTP R2 transport: native Miniflare6/6 including importer/replay, real
  conditional conflict, app GET/HEAD, identity gates and exact-key cleanup.
  Syntax/focused lint pass. These are local HTTP/native proofs.
- Candidate8c17c7e/CI37112092427 passed both jobs; the first full remote
  attempt **failed before schema/data import**, at temporary Worker deploy.
  Its three D1/two empty R2 resources were deleted. Independent API metadata
  readback at09:26:21.141Z proves original inventory equality and Worker absence.
  The restore is not accepted. A read-only temporary-config whoami selected an
  unrelated account instead of the dedicated staging profile; fix and preflight
  explicit credentials before another resource-creating attempt. The original
  deploy CLI diagnostic was discarded, so its exact provider error is unknown.
  Journal:/tmp/fanmark-combined-remote-fom0pq/journal.json.
  Synthetic provision/restore duration includes temporary resource bootstrap;
  it must not be presented as production RTO.

Private local logs:
`/tmp/fanmark-recovery-shared-bundle-regression.log`,
`/tmp/fanmark-recovery-r2-transport-final.log`.
