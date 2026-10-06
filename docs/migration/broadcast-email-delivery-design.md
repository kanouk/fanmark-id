# Broadcast email delivery on Cloudflare

## Purpose and current state

The Supabase `send-broadcast-email` function sends one administrator-selected
broadcast to the Auth users matching an optional plan, language, and registration
date filter. It falls back to Japanese when a language-specific template is
missing, then updates recipient totals, sent/failed counts, status, and an audit
row. Its current implementation performs the whole delivery in one request and
does not provide durable per-recipient retry state.

Cloudflare staging has MFA-gated draft, template, recipient-count, and
fixed-recipient test-send paths, plus the default-off durable bulk queue,
Resend dispatcher, and signed webhook handler in the deployed Worker bundle.
The fixed-recipient test-send API delivered the one explicitly approved message
on 2026-10-06; the send UI and bulk delivery remain unaccepted. Bulk/test-send
selectors, the fixed test recipient, and the webhook signing secret were removed
after cleanup. Auth verification/reset email acceptance is separate from broadcast
acceptance. See [the fixed-message evidence](evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json).

The additional Business migration `0025_broadcast_delivery_terminal_outcomes.sql`
fixes event ordering in both webhook insertion and provider-ID attachment. A
complaint takes precedence over a permanent bounce; either takes precedence over
subsequent delivery/failure events for that provider message. Other outcomes use
receipt time and event ID, so transient failures can recover and clear the error
code. No provider occurrence-time ordering is inferred. Only an actual suppression
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

## Remaining operator policy

The recipient-queue retention period and who may release a send paused after an
uncertain provider response are operational policies. Do not delete recipient
evidence or auto-retry beyond the provider idempotency window until those
policies are recorded. This policy gate does not block local implementation or
synthetic testing; it blocks provider-backed real delivery and production
acceptance.

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
