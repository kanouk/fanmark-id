# Broadcast email delivery on Cloudflare

## Purpose and current state

The Supabase `send-broadcast-email` function sends one administrator-selected
broadcast to the Auth users matching an optional plan, language, and registration
date filter. It falls back to Japanese when a language-specific template is
missing, then updates recipient totals, sent/failed counts, status, and an audit
row. Its current implementation performs the whole delivery in one request and
does not provide durable per-recipient retry state.

Cloudflare staging has MFA-gated draft/template/recipient-estimate APIs and a
default-off durable bulk queue. On 2026-10-08, an actual same-session MFA send
command, natural minute Cron snapshot/dispatch, one owned filtered recipient,
and real signed Resend sent/delivered reconciliation were accepted together.
The request-ID repeat returned the same run without another provider attempt.
After exact-owned cleanup, the bulk/test-send selectors are disabled again;
the approved signed receiver and signing secret remain enabled. Native send UI,
multi-recipient dispatch and operator retry/retention remain distinct gates.
On 2026-10-09, an isolated native Cloudflare Worker with exact full Business/Auth
schemas (plus a separate private call-settlement table) snapshotted 51 synthetic users across four languages: 50, then 1, then
an empty completion page and an idle repeat. Every ID/language, cursor, count
and lease was read back, with no duplicate or email address in the queue.
No Resend credentials, sender/dispatch route or Cron were bound; actual email
sending was zero. Owned resources were removed and independently verified.
This accepts the snapshot page boundary, not 51-recipient dispatch or send UI.
[Native snapshot evidence](evidence/broadcast-snapshot-boundary-native-2026-10-09.json).
On 2026-10-09, two official Resend simulator messages produced real signed
permanent-bounce and complaint receipts in staging. The native effective-event
view retained bounced/permanent_bounce and suppressed/complaint, including a
delivery event after the complaint. No queued recipient/run was attached to
these two messages, so recipient reconciliation and suppression linkage remain
separate from this provider-ingress acceptance. See
[real terminal simulations](evidence/resend-real-terminal-simulations-2026-10-09.json). See
[the bounded real delivery evidence](evidence/staging-broadcast-single-recipient-2026-10-08.json)
and [the signed receiver/replay evidence](evidence/staging-resend-signed-webhook-2026-10-08.json).
Auth verification/reset mail acceptance remains separate.

On 2026-10-09, the current main staging Worker completed a closed-date,
four-language 51-recipient campaign using only official Resend simulator
addresses. The MFA command deduplicated, natural minute Cron snapshotted and
dispatched, and 103 real signed receipts reconciled 49 delivered, one permanent
bounce and one complaint to current totals 51/49/2. A delivery after the complaint
did not clear its suppression. Every provider attempt count was one; this does
not accept actual provider retry or native send UI. Bootstrap and cleanup used
the same main V2 writer namespace without changing source schema. After returning
to receive-only, all 52 owned users/profiles, campaign queue/suppressions/audits
and the private operator were removed. An independent read-only process matched
the source schemas and all other current/retained table hashes; only minimal
signed receipts and monotonic MFA generation remained changed.
See [51-recipient native delivery](evidence/staging-broadcast-multi-recipient-native-2026-10-09.json).

The bounded staging test retains fixtures and proof until known terminal signed
reconciliation. Unknown/review outcomes are retained for investigation by the
service owner rather than manually released or cleaned. Existing retries use
the same payload/idempotency key, at most five attempts within the 24-hour
provider window; no retry occurred here. This records staging test handling,
not adoption of a production queue retention/deletion policy. No real audience
or additional message was sent to test retry or suppression exclusion.

The additional Business migration `0025_broadcast_delivery_terminal_outcomes.sql`
fixes event ordering in both webhook insertion and provider-ID attachment. A
complaint takes precedence over a permanent bounce; either takes precedence over
subsequent delivery/failure events for that provider message. Migration0025 originally used receipt time for other outcomes. Additional
0026 stores the signed payload root `created_at` separately and orders those
outcomes by provider occurrence time, with event ID as a deterministic tie-breaker.
The nested `data.created_at` is the email creation time and is not used for event
ordering. UTC offset/calendar validation retains all fractional digits, including
precision beyond milliseconds and microseconds. Sorting uses normalized fractional
text rather than floating-point dates, so fractional prefixes/trailing zeros do not
reverse chronological order. A newer transient recovery can clear an older failure;
a late older failure cannot erase the recovery. Missing/invalid root timestamps
are rejected without writes. Existing receipts retain NULL occurrence time, with
receipt time only as an explicitly unknown-history fallback; no time is invented.
See the [Resend delivered payload](https://resend.com/docs/webhooks/emails/delivered). Only an actual suppression
cancels another pending/inflight recipient. The effective-event view stores no
additional payload or address. Applying the migration does not rewrite historical
rows or send mail; older inconsistent records require explicit reconciliation.

Reconciliation also refreshes previously completed/failed run and campaign counts
when a later event changes the result. Snapshotting/cancelled runs remain untouched.
The original `BROADCAST_EMAIL_SENT` audit remains immutable and unique per run; it
records the first send-completion snapshot, while current delivery totals live on
the campaign and recipients. The full-runtime regression cases failed on all five
checks before the fix and pass afterward, alongside signature, duplicate,
snapshot-resume, idempotent retry and review-pause tests. Remote synthetic handling
and delivery by Resend are distinct acceptance conditions.

## Data and delivery boundary

- The send command must be an explicit, MFA-authorized administrator action.
- Before the first provider call, freeze the selected audience as an immutable
  set of Auth user IDs and the language chosen for each user. The current
  implementation scans Auth IDs lexicographically in 50-user pages, excludes
  identities created after the send command, and evaluates the Business D1
  filters as each page is read. A committed page is immutable; retries do not
  re-evaluate it. Since Auth D1 and Business D1 cannot share a transaction,
  settings changed while a long snapshot is in progress can affect later pages.
  No delivery starts until every page is committed.
- Do not copy email addresses into Business D1 or the broadcast queue. Resolve
  each current address from Auth D1 immediately before delivery. If the Auth
  user no longer exists or has no valid address, record a non-delivery outcome
  without logging the address.
- Snapshot language and the effective subject/body/template version before
  delivery begins. A template edit after sending starts must not change the
  payload of a retry.
- A queue row contains only the broadcast ID, Auth user ID, language, delivery
  state, attempt metadata, provider message ID, and bounded provider error code.
  It also contains a keyed HMAC fingerprint of the complete outgoing payload so
  a retry detects any changed address or message without storing the address.
  Never persist raw provider response bodies or recipient addresses there.
- Existing suppression rows are excluded from every snapshot page, and a new
  permanent bounce or complaint cancels matching pending/inflight work.
- Staging keeps the bulk-send selector off. The existing test-send path remains
  separate and may address only the single server-configured test recipient.

## Durable execution

The snapshot and delivery functions are selected by the registered
`* * * * *` Cron only when both `BROADCAST_EMAIL_BACKEND=d1` and
`BROADCAST_SEND_BACKEND=d1` are configured. Draft editing alone needs no
delivery scheduler. Staging already registers the minute trigger for Stripe,
but keeps bulk send disabled with the missing broadcast selector. Activation
must reconcile the existing baseline/secrets guards. `npm run check:cloudflare-schedules`
rejects a missing trigger or missing draft backend in the base config. The
notification processor continues to use its Durable Object and is not
selected by this minute Cron. Remote schedule delivery, Resend acceptance,
signed delivery events, and retry/reconciliation are separate acceptance gates.

1. `POST /api/admin/broadcast-emails/send` validates a UUID request ID, an
   eligible draft, current administrator MFA, and the explicit D1 selector.
   A unique command key binds that request ID to the broadcast and administrator.
2. The command snapshots the audience in bounded pages. A durable cursor and
   per-page transaction make a retry resume at the last committed page. The
   command cannot enter `sending` until the full audience and template snapshot
   are complete. A five-minute lease prevents concurrent page owners; D1
   compare-and-swap gates every page insert. The current implementation fails
   closed if more than 10,000 eligible identities are found.
3. A scheduled Worker claims a bounded number of pending recipient rows with a
   lease. The local implementation sends sequentially through Resend with a
   bounded retry count and delay, then records the outcome with a
   compare-and-swap on the lease token.
4. Each recipient uses one stable Resend idempotency key for every retry. A
   changed payload is paused for operator review; the keyed fingerprint detects
   changes before another provider call. The current Resend idempotency
   retention is 24 hours; an unresolved delivery
   older than that window must pause for operator reconciliation instead of
   being resent automatically. See [Resend's idempotency-key contract](https://resend.com/changelog/idempotency-keys).
5. The broadcast counters and terminal status are projections of the durable
   recipient rows. A crash after provider acceptance but before D1 acknowledgement
   must be safely replayable within the provider's idempotency window.
6. The API exposes aggregate counts only. It does not return user IDs,
   addresses, message contents, or per-recipient provider error details.

## Delivery events and message policy

The existing broadcast templates describe important service notices and the
legacy sender states that these notices cannot be unsubscribed from. The first
Cloudflare release preserves that source behavior and does not reinterpret
these messages as marketing mail. It must accept only the three existing
service-notice types and the four supported languages.

Resend webhook events must be verified against the raw request body and a
dedicated signing secret. Event ID insertion must be idempotent. Delivery
events update only the matching provider message row. Permanent bounce and
complaint events suppress that Auth user from future broadcast snapshots;
transient bounce events remain visible as delivery failures and do not create a
permanent suppression. Event logs must not retain raw payloads or email
addresses. Resend documents per-recipient email events, permanent/transient
bounce categories, and signed webhook verification in its
[event documentation](https://resend.com/changelog/webhook-event-visibility),
[bounce details](https://resend.com/changelog/email-bounce-details), and
[webhook verification guide](https://resend.com/changelog/managing-webhooks-via-api).

## Configuration and activation

Reproduce the read-only preflight against an explicitly identified deployment:

```sh
node scripts/migration/staging-broadcast-preflight.mjs --read-only --expected-version=b3a770b3-8735-4b31-abdd-f4fca99e05cd
```

This command uses the identified app-config Wrangler OAuth credential, not the
least-privilege monitor token. It reads the fixed staging Worker and Business
D1 only, verifies SELECT receipts (`rows_written=0`, `changed_db=false`), checks
the 16 Auth / 12 broadcast template content baselines, and emits allowlisted
configuration-presence flags and queue counts. It never prints credentials,
template bodies, addresses, or raw provider responses and cannot activate/send.
The current readback found zero drafts, runs, recipients, suppressions, webhook
events, test-send audits, and pending email/Web Push notifications.

The first provider rehearsal should use the separate fixed-recipient test-send
route, one synthetic MFA-authorized draft, and an explicitly approved address
and message. Prepare the exact content and cleanup journal before requesting
send authorization. Verify provider acceptance and audit, then remove only the
journal-owned fixture. This does not close durable bulk dispatch, signature,
bounce/suppression, retry, or retention-policy gates. Keep the main Worker
version unchanged while its natural daily observation is in progress.

Bulk delivery remains fail-closed unless all of these are explicitly selected:

- server `BROADCAST_EMAIL_BACKEND=d1` and split D1 topology;
- server `BROADCAST_SEND_BACKEND=d1`;
- frontend `VITE_BROADCAST_EMAIL_BACKEND=worker` and
  `VITE_BROADCAST_SEND_BACKEND=worker`;
- a valid server-side Resend key and approved sender;
- a configured Resend webhook endpoint and signing secret before any real
  broadcast is accepted.

Production defaults remain on Supabase until the final application cutover.
The implementation, synthetic proof, selectors, and deployment do not authorize
a real audience snapshot or real email delivery.

## Receiving while sending is paused

`BROADCAST_WEBHOOK_BACKEND=d1` enables the signature-verified receiver independently
of bulk sending. It still requires `BROADCAST_EMAIL_BACKEND=d1`, split Business D1,
and the signing secret. Without an explicit receiver selector, existing send-enabled
configurations retain their previous behavior. An explicit non-D1 selector blocks
the receiver, send-start and dispatch. Keeping `BROADCAST_SEND_BACKEND` unset stops
snapshotting and dispatch even when the receiver is enabled; late provider events
can still update recipients and suppression. No new route or schema is introduced.
The native D1 regression checks signed deduplication/reconciliation of an already
completed run with sending paused, unchanged recipient count, and zero provider
calls. Remote registration/deployment was accepted on 2026-10-08; see the scoped evidence below.

## Acceptance tests

- concurrent starts with the same request ID create one command; a changed
  payload under that ID is rejected;
- audience filters, no-filter users, missing settings, missing Auth identities,
  language fallback, immutable recipient membership, and template snapshots
  match the source contract;
- crashes during snapshot paging resume without missing or duplicating a
  recipient;
- concurrent Cron invocations cannot claim the same recipient;
- provider acceptance followed by lost acknowledgement retries with the same
  key and payload; a payload conflict is never retried with a new key;
- transient errors retry with bounded backoff; permanent failures terminate;
- a delivery still uncertain after the provider idempotency window pauses for
  operator reconciliation;
- signed duplicate webhook events are applied once; invalid signatures,
  malformed event bodies, and unsupported event types make no writes;
- permanent bounce/complaint suppression affects only the matching Auth user;
- no test or synthetic run sends to an address outside the server-configured
  fixed test recipient, and aggregate API responses contain no recipient data;
- provider secrets and webhook secrets are absent from source, build artifacts,
  logs, and reports.

## Operator policy for the initial Cloudflare release

The [hold and investigation runbook](broadcast-operations.md) adopts the service
owner as investigator, a minimum30-day terminal-record hold followed by owner
review, continued holds for unresolved/idempotency/suppression evidence, and
no forced post-window retry or automatic purge. The existing authorization to
continue noncritical migration work covers this preservation policy; it does
not authorize production sending, user-record deletion or forced recipient
release. The retention and investigator decisions are recorded, rather than
left as a separate approval wait.

A new resume API or automatic purge is not added as a migration requirement.
Unknown provider outcomes remain held for owner investigation. Any future
release/deletion change must preserve request identity, deduplication and
suppression, with exact evidence and a separately reviewable implementation.
Controlled owned-fixture cleanup remains a separate approved test operation.
Production cutover and actual operation retain their existing verification
scope; no production delivery is accepted by this policy record.

## Local implementation checkpoint (2026-09-27 JST)

Migration `0016_broadcast_email_delivery.sql`, idempotent send-start UI/API,
Auth-ID/language snapshot paging, leased Resend dispatch, and signed webhook
ingestion are implemented locally. Synthetic integration tests pass for
address-free schema, suppression, bounded snapshots, exact-payload retry,
changed-email pause, concurrent claims, raw-body signature verification,
duplicate-event handling, terminal audit idempotency, lost acknowledgement
after committed page state, and the 24-hour idempotency stop. The frontend and
Worker API contracts are typechecked and unit-tested. Authenticated browser
review of the updated send control, deployment, queue policy, and provider-backed
acceptance remain open. All runtime delivery selectors remain off.

The admin list now reports the bounded state `delivery_status=needs_review`
when an uncertain delivery is paused. The UI labels it “要確認・送信停止中”
and states that automatic retry is stopped. The Worker DTO deliberately maps
only this fixed state out of `error_details`; raw provider bodies and any
address-like detail remain hidden. Worker/API contract tests verify this
redaction. The worker and static bundle are also deployed to staging version
`30ce0b27-fb72-4400-a8b6-6d86b46b5167`. An authenticated synthetic TOTP canary
confirmed that the visible `needs_review` projection omits the address-like
marker and provider response, while bulk and test send remain selector-disabled
503s. Cleanup and independent D1 readbacks found all affected Auth and business
rows at zero. This does not verify provider-backed delivery; visual browser
review remains open because the host Mac was locked.

2026-10-06 acceptance: candidate eeb4f6a passed both jobs in CI 37414547662. The full 26-migration Business schema matched in an owned remote D1; eight signed HTTP scenarios and invalid/duplicate events passed through the actual isolated Worker handler. The owned D1 and Worker were deleted and original resources/data preserved. Staging now uses Worker b3ce17ce-cd56-464c-8694-2215dce51b39 and ledger26, with bulk/test sending still disabled. See [bounded ordering and deployment evidence](evidence/broadcast-terminal-outcomes-2026-10-06.json). This does not accept delivery from Resend or the send UI/bulk/retention.

0026 acceptance: candidate a5a2b75 passed both jobs in CI 37416934627. An owned remote D1 matched all 27 Business migrations; the isolated actual Worker accepted eight terminal-outcome cases and eight chronology cases across both arrival and ACK orders. Missing or invalid signed provider timestamps made no writes, exact fractional provider time survived, and duplicate receipts remained unique. Owned resources were deleted and original resources/data preserved. Staging now uses Worker 0605e4ed-38d2-4e09-967e-3c3f3c99910d and ledger27, with sending disabled. Separate readback matched retained tables, the two changed definitions, other schema, secret names and four public assets. See [provider chronology evidence](evidence/broadcast-provider-chronology-2026-10-06.json). The0025/26-migration proof remains historical; Resend service delivery, send UI/bulk/retention and full combined recovery under27 remain separate.

## Actual Resend signed callbacks (2026-10-08 JST)

The user explicitly approved the Workspace-wide webhook and secret destinations.
One fixed-recipient email was sent through the MFA-protected staging test API.
The actual `email.sent` and `email.delivered` callbacks returned HTTP 200, and
matched the two minimized Business D1 event rows. A provider replay of the
same delivered event succeeded with test and bulk sending disabled; the event
rows were unchanged. Owned actor, draft, audit and event rows were cleaned.
Independent readback retained the other table hashes and Auth 3/7/2; the MFA
generation advanced from 256 to 258 and was not reset.

Staging Worker `cbb800a3-9f71-4a90-b21c-6fe87d2d7b12` keeps
`BROADCAST_WEBHOOK_BACKEND=d1` and the signing secret. The canonical staging
configuration enables this receiver but leaves bulk and test sending disabled.
This does not accept bulk audience delivery, actual bounce/complaint/failure/
suppression events, operational retry/retention policy, or full migration.
[Scoped evidence](evidence/staging-resend-signed-webhook-2026-10-08.json).

### 2026-10-09: controlled post-acceptance state and real provider retry

One official delivered simulator recipient was first accepted and reconciled by
real signed receipts. A tracked, exact-owned Business batch then injected the
pending/null-provider-id/provider_network_error state while retaining the
payload fingerprint, first attempt time, 24-hour window and completion audit.
The next natural minute Cron called real Resend again: attempt count changed
from one to two, the same provider ID returned, and persisted signed receipts
reconciled delivered with totals 1/1/0. The first completion audit was unchanged.
This accepts real idempotent provider replay after a controlled state fault;
the first ACK was observed, so actual lost transport responses, 429 and outages
are not claimed. No API response was replaced. No provider or Auth signing
secret was copied to the operator. Source schema and normal frontend stayed
unchanged. Receive-only settings were restored, exact-owned fixtures/operator
removed, and independent current/retained hash and FK checks passed. Only
minimal signed receipts and monotonic MFA generation remain changed.
See [controlled state / actual retry evidence](evidence/staging-broadcast-controlled-provider-retry-2026-10-09.json).
At this checkpoint, native Send UI and production queue retention adoption remained separate.

### 2026-10-09: actual native Send UI acceptance

A separate Chrome session used a synthetic admin to sign in, pass TOTP MFA,
create a draft, select Free/ja with a closed historical registration range,
verify the visible estimate of one and preview the persisted content. One native
AX confirmation click queued the run. Two earlier CDP input deadlines were
confirmed undispatched with independent run/audit counts of zero. No API draft
creation/send substitute or manual Cron was used. Natural Cron and two real
signed sent/delivered receipts completed one attempt with native D1 and UI
totals 1/1/0. Actual UI logout was followed by restoration of the original
assets and receive-only configuration, exact-owned fixture/operator cleanup,
and independent current/retained schema/hash/FK and configuration checks.
Only two minimal signed receipts and monotonic MFA generation remain changed.
The owner IAB session was preserved. No source runtime or schema changed.
Production queue retention, human OAuth setup, physical phone/PWA and final
integration remain separate. [Native UI evidence](evidence/staging-broadcast-send-ui-native-2026-10-09.json).
