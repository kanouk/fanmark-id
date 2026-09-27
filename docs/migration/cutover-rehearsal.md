# Synthetic cutover and recovery rehearsal

Parent issues: [#28](https://github.com/kanouk/fanmark-id/issues/28) and
[#37](https://github.com/kanouk/fanmark-id/issues/37).

## Scope and current decision

This runbook defines the synthetic staging rehearsal for moving the application
write authority from Supabase to Cloudflare. It does not authorize a production
freeze, read or copy real user rows, switch public hostnames, or change DNS.
Those operations remain in the final phase tracked by #38.

The systems must have exactly one business-data writer at a time. Supabase
remains authoritative until a reviewed final import is reconciled. Cloudflare
staging canaries use synthetic identities and rows only. Do not enable a
production selector or a second writer to make this rehearsal easier.

Reverse migration after Cloudflare accepts a successful business write is not
proven. The recovery policy is therefore split at that event:

1. **Before Cloudflare accepts writes:** keep the application in maintenance,
   disable Cloudflare write selectors, and resume the old Supabase application
   only after confirming no Cloudflare business write succeeded.
2. **After Cloudflare accepts a write:** keep Cloudflare as the sole authority.
   Repair forward on Cloudflare while in maintenance. If the Worker cannot
   serve traffic, retain maintenance and use individual support; do not point
   traffic at Supabase, because that would hide the accepted Cloudflare write.
   A later recovery must restore a verified Cloudflare backup and reconcile its
   durable operation/Stripe ledgers before writes resume.

No old/new dual-write window is allowed. Once Stripe receipt intake is moved,
one durable receipt ledger remains available throughout. A single dispatcher
applies each event to business state; the previous dispatcher is stopped before
the new dispatcher is enabled. Receipt continuity does not mean both systems
may apply the same event.

The latest read-only source inventory (2026-09-27 JST) found Supabase
`check-expired-licenses-daily` active at `0 0 * * *` with direct target
`check-expired-licenses`; its `cron.timezone` is `GMT`. The old
`process-notification-events-every-minute` job is inactive. These are current
production observations, not staging actions. Before the final writer freeze,
re-read the source jobs and timezone, stop the then-current old expiry schedule,
and confirm no old invocation remains in flight before enabling the Cloudflare
daily lifecycle trigger. Do not change the production schedule during the
staging rehearsal.

## Rehearsal sequence

Run each phase against the isolated workers.dev app and staging D1/R2 resources,
with synthetic identities and unique marker values. Record start/end times,
commands, deployment IDs, database names, counts, digests, and cleanup readback.
Do not record tokens, password hashes, email addresses, or row contents in the
public report.

| Phase | Action | Evidence required to continue |
| --- | --- | --- |
| 0. Preflight | Confirm staging account and exact Worker, split D1, R2, Cron, selectors, and backup bucket. Confirm default/production selectors still use Supabase. Pin the current master-release digests and synthetic test identities. | Account/resource readback; no production hostname or production binding; synthetic-only preflight. |
| 1. Prepare | Build and test the Worker/SPA. Apply the reviewed D1 migration chain to an empty disposable rehearsal target. Verify master release pointers and required allowlisted configuration. Keep signup, business mutation, lifecycle, and Stripe dispatch closed until the rehearsal enables them explicitly. | Clean migration ledger; schema and master digests; route/selector inventory; synthetic canary cleanup preflight. |
| 2. Quiesce old writers | In staging, enable maintenance and stop all old application mutation paths and scheduled business writers. Drain or account for in-flight writes. Keep the old Stripe receiver durably recording receipts while its business dispatcher is paused. Confirm only one receiver/ledger owns each event ID and no event is lost or applied twice. | Anonymous and synthetic old-path writes are rejected; Cron/business writers are stopped; receipt IDs are durable; in-flight count is zero or reconciled. |
| 3. Final synthetic copy | Capture a catalog-fingerprinted repeatable-read snapshot and a separate Storage inventory. Import the synthetic business snapshot into the disposable D1 target, seed only reviewed masters, and apply the reviewed credential transform to synthetic credentials. | Snapshot verification; row/key/hash and FK reconciliation; sequence state; Storage object hash/readback; no unresolved import acknowledgement. |
| 4. Resume new writer | Enable only the staging Worker selectors. Enable the single chosen Stripe dispatcher after receipt-ledger handoff. Exercise registration, owner updates, return/transfer/lottery, notification processing, R2 upload/delete, one duplicate/replayed synthetic event, and the PWA shell while offline. | Synthetic end-to-end results; exact event-once behavior; D1/R2 readback; offline navigation serves only the static shell while API requests remain uncached; old write paths remain closed; cleanup leaves only documented master and anti-replay state. |
| 5. Recover | Run two explicit failure drills: fail before the first Cloudflare business write and fail after one acknowledged Cloudflare write. Prove the pre-write path can resume Supabase, and prove the post-write path stays on Cloudflare under maintenance and restores/reconciles from its verified backup. | Timestamped recovery record, measured interruption for each drill, restored digests, and exact synthetic row/ledger reconciliation. |

Measure the user-visible interruption from the first old-path rejection through
the first successful new-path synthetic mutation. Report this as a staging
measurement, not a production RTO promise. Record snapshot/export/import and
reconciliation durations separately so the maintenance window can be estimated
from observed work rather than assumed.

## Go/no-go gates

The rehearsal is not complete until each applicable gate has evidence. A green
unit suite or an empty-table readback alone is insufficient.

- The refreshed source catalog fingerprint matches the conversion and import
  artifacts. The latest checked-in status reports 18 unresolved schema gates
  and `deployable: false`; the full schema/import gate is therefore still open.
- The current schema's synthetic import/restart rehearsal passes, including
  constraints, sequence state, exact codecs, credential transform, and
  typed readback. This does not imply that real user rows have been exported.
- Auth identity mapping and Storage object inventory are represented by
  separate, verified synthetic artifacts; neither is inferred from the public
  database snapshot.
- Stripe receipt intake, dispatch ownership, and replay behavior are explicit.
  The current staging selectors/secrets keep payment routes closed, so the
  Stripe handoff drill has not passed.
- Each recovery drill records elapsed time and exact reconciliation. Until the
  post-write forward-recovery drill passes, returning traffic to Supabase after
  a Cloudflare write remains prohibited.
- A separate review confirms the implementation, deployment, and operational
  evidence. Production approval and DNS are outside this runbook.

## Evidence at 2026-09-27

Already verified with synthetic data: integrated staging registration/Auth/
business/R2 flows; lifecycle Cron canary and cleanup; encrypted snapshot
restore across processes; private staging R2 encrypted-object round-trip;
staging master edit/restore; and current-catalog importer rehearsal over all
40 source tables. Local migration-data, Worker, typecheck, staging-build, and
Wrangler dry-run suites are recorded in [HANDOFF.md](HANDOFF.md).

The current staging deployment has an isolated anonymous browser check: `/plans`
and `/plan` redirect to `/auth`; the active service worker controls `/pwa`, its
precache includes both manifest icons, and offline reload serves the shell
while the API/catalog request shows the retry screen. Native installation and
service-worker update transitions remain unverified.

Not verified: a coordinated old-writer freeze with Stripe receipt continuity,
a timed full final-copy window, both recovery drills, resolved schema gates,
live Stripe sandbox acceptance, production backup key custody/retention, or
production operation. The 2026-09-27 read-only Supabase catalog query now
succeeds through `npx supabase@2.118.0`; it reads no application rows and still
produces 18 blocking schema-conversion gates. Earlier on 2026-09-27, Wrangler
authentication worked and staging Worker version
`cdeb759e-8e52-4b8a-9d63-6451b871c262` was deployed at 100%. A later device
reauth was approved for the intended account with limited Workers and D1
scopes, but Wrangler could not read its local macOS Keychain key (exit 51); see
the current state in [HANDOFF.md](HANDOFF.md). These updates do not close the
source schema gates or constitute a completed integration/cutover rehearsal.

The user-data import and public domain/DNS switch remain explicitly deferred.
