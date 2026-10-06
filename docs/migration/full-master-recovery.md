# Full staging Master recovery proof

## Scope

This rehearsal exports the current staging Master database with the account-bound
read-only monitoring credential. It covers all 24 application tables, including
release history, canonical emoji records, reference releases and retained empty
legacy Auth tables, plus the `d1_migrations` ledger. It reads no Supabase rows and
does not change existing remote D1, Worker configuration, R2 or domains. The
remote rehearsal below creates, writes and then deletes one explicitly owned
isolated D1 only.

The retained legacy `user`, `account`, `session`, `verification`, `twoFactor`,
`adminRole` and `mfaAssurance` tables are checked empty before export. Master
`mfaGeneration` is system bookkeeping and is preserved. This rehearsal does not
back up the separate Auth D1 or its real credentials.

## Procedure and boundaries

1. Verify the exact staging account, Master database and 100% Worker version.
2. Read every non-provider schema object and all table rows using validated
   identifiers and a bounded row count. Provider `_cf_*` and SQLite internal
   objects are excluded; retain the application migration ledger.
3. Compare full schema and every table's count/hash before and after capture.
   Stop if anything changes or any foreign-key check fails. Multiple reads are
   a stability check, not an atomic production snapshot guarantee.
4. Seal the schema and rows in one AES-256-GCM archive with authenticated format
   metadata. Store archive and the one-off proof key in separate private files.
   Decrypt the saved bytes, compare plaintext hash and reject a tampered archive
   before any restore operation.
5. Restore only to a newly created local database. Create tables, insert explicit
   captured columns within a deferred-constraint transaction, then restore
   indexes/views/triggers. Installing write triggers after rows avoids replaying
   business effects during restore. Reopen the target and compare every schema
   object, row count/hash and foreign keys.
6. Repeat restoration in an isolated Miniflare/workerd D1 target and exercise
   the actual application emoji and reference-master repositories. This remains
   local; it is not remote D1 provisioning or remote recovery acceptance.
7. Use a separate process and the read-only credential to confirm unchanged
   remote Master counts/hashes, foreign keys and current Worker version.

Raw data, restored database, encrypted archive and proof key stay outside Git in
0700 directories/0600 files. Public evidence contains only hashes/counts, timings
and acceptance boundaries. The one-off local key is not adopted operational key
custody, an off-host backup or scheduled retention. Do not publish or attach raw
archive contents or keys to the PR.

## Remaining operational requirements

Agree the operator, key custody/recovery access, schedule, retention and off-host
storage; implement an atomic production snapshot method and adopt a production restore
procedure. The isolated full-Master remote rehearsal below is accepted; Auth credential recovery and final combined Master/Auth/Business/R2
integration remain separate requirements. Local restore timings do not establish
production RPO or RTO, and this proof does not complete the migration.

## Accepted local rehearsal (2026-10-06 JST)

At staging Worker `8cbe1e5f-5e55-4a82-a853-65ec96051db2`, all 25 tables contain
12,254 rows in total, including 3,944 canonical emoji records and 7,888 staged
release records. All 98 non-provider schema objects and every table count/hash
match after decryption and restoration. Foreign-key violations are zero.
Tampered ciphertext is rejected before restoration.

Local SQLite restoration/reopen verification took 247ms. Isolated Miniflare/
workerd restoration and actual application reads took 93,691ms. The actual emoji
repository reads all 3,944 active records; the reference repository reads 4 tiers,
4 languages, 5 active reserved patterns and 16 active extension prices. Inactive
rows and release history remain present in the restored tables.

A separate read-only process confirmed every source table count/hash and the
Worker version unchanged. Remote writes are zero. These are local proof timings;
neither is a production RTO. The encrypted archive and one-off key remain private.
[Hashes, counts and explicit boundaries](evidence/full-staging-master-local-recovery-2026-10-06.json).


## Remote trigger diagnosis (2026-10-06 JST)

Two isolated full-data restore attempts reached the trigger batch and failed;
appending an outer semicolon did not resolve the REST failure. Both owned targets
were deleted and the original inventory restored. A subsequent schema-only
probe established that the retained `mfa_generation_factor_delete` definition
fails unchanged or with a semicolon, but succeeds when only its body `begin`
becomes `BEGIN`. All 58 triggers then applied, with all 98 schema objects matching
that explicit keyword correction. No source rows were inserted in this probe.

This matches the reported [D1 REST splitter issue](https://github.com/cloudflare/workers-sdk/issues/15314).
`scripts/migration/d1-rest-trigger-sql.mjs` provides opt-in preparation of already
validated single trigger definitions. It preserves quoted identifiers, literals,
comments and every other byte; it rejects unsupported/ambiguous input. Arbitrary
SQL in the REST transport stays unchanged. Source schema/archive bytes remain
unchanged. Target schema verification must expect this exact keyword correction
and cannot claim byte-identical raw trigger SQL.

The native regression proves preserved trigger effects/literals; the schema-only
remote probe establishes the actual REST workaround. At this diagnosis checkpoint, full remote data recovery was still unaccepted.
The corrected complete run below subsequently passed all-row/application readback,
owned-resource cleanup and separate source preservation verification.
[Bounded diagnosis](evidence/d1-rest-trigger-casing-2026-10-06.json).


## Accepted isolated full remote rehearsal (2026-10-06 JST)

After both CI jobs passed at `801dc784226e41828d0f7c3a6bcc56615b18783b`
([run37405218853](https://github.com/kanouk/fanmark-id/actions/runs/37405218853)),
the unchanged saved AES-GCM archive was decrypted and restored into one newly
created account-bound, receipt-pinned D1. All25 tables/12,254 rows matched their
source counts and hashes; all98 schema objects matched with the sole body-BEGIN
case correction on six retained legacy MFA triggers. Raw source schema and the
archive were unchanged. FK violations were zero. Source schema SHA256 is
`32a98726c6e3e75d3b561657e20685b82cdfa38530ee7b3221505d44693a5f56`;
restored schema SHA256 after that correction is
`3ca374efa733a5c6db5e71918bae25e259bdc1b4a7b1b2d3d96dda1e6fba2240`.

The actual application readers returned all3,944 active emojis and tiers4,
languages4, active patterns5 and active extension prices16. Restore plus target
verification took27,161ms after target/schema preflight; it excludes account/CI
preflight, resource creation, final deletion and operator recovery work. This is
a rehearsal measurement, not a production RTO or atomic-source snapshot proof.

The owned target was deleted by exact receipt identity. A separate read-only
process at02:52:38.154Z confirmed the original three-DB inventory and all Business,
Auth and Master table hashes unchanged, FK0 and unchanged Worker8cbe1e5f. No
existing DB writes, Worker deployment, R2 or DNS changes occurred. Separate Auth
credentials were not exported or restored. All prior failed targets were also
cleaned. [Full bounded remote proof](evidence/full-staging-master-remote-recovery-2026-10-06.json).

The private v3 journal is completed and must not be replayed. Scheduled/off-host
backup, durable operator/key custody/retention/RPO-RTO, full synthetic Auth remote
recovery and final combined recovery remain open. This closes only the isolated
full staging Master remote-restore requirement, not the six-package migration.
