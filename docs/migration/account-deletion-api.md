# Account deletion through Better Auth and D1

`POST /api/me/account/delete` implements the self-service account deletion path for the Cloudflare staging build. Both `VITE_ACCOUNT_DELETION_BACKEND=worker` and `ACCOUNT_DELETION_BACKEND=d1` are required. The production build continues to invoke the existing Supabase Edge Function.

The request must be same-origin, authenticated by the Better Auth session, and contain exactly `{ "confirmation": "DELETE", "password": "…" }`. The Worker verifies the password before starting billing or business effects. The direct Better Auth `/api/auth/delete-user` and callback routes remain closed; the coordinator deletes the authenticated identity through guarded Auth D1 cascades after business cleanup. The SDK deletion endpoint is disabled as well as denied by the gateway.

The coordinator checks the source `broadcast_emails.created_by` no-action foreign key before any side effect. It resolves Stripe customer IDs only from the signed-in user's D1 `user_settings` and `user_subscriptions`; it never searches Stripe by email. A customer shared with another D1 user, missing mode-specific Stripe secrets, an ambiguous test/live customer, a mismatched Stripe customer, or an unconfirmed cancellation stops deletion. The default `STRIPE_MODE_POLICY` requires both `STRIPE_SECRET_KEY_TEST` and `STRIPE_SECRET_KEY_LIVE` whenever the account has a Stripe customer link. With `STRIPE_MODE_POLICY=test_only`, only the test key is constructed and queried; live-key configuration is rejected. Every nonterminal subscription for the exact matched customer is cancelled immediately and read back as canceled.

Every valid active license, including one with `license_end IS NULL`, is returned through the same compare-and-set and active-transfer guard as the ordinary D1 return API. Favorite-availability notifications and the account-deletion return audit are retained; the soon-to-be-deleted owner notification is suppressed. After return, one business D1 batch removes favorites, notification inbox/preferences, user settings, roles, enterprise settings, and subscription projections; clears license ownership while preserving license history; cancels pending lottery entries; clears the historical winner's direct user ID; and records an account-deletion audit without email. Pending notification events addressed to the deleted user are removed so the scheduled processor cannot recreate the deleted inbox.

The source catalog also has a no-action constraint from `broadcast_emails.created_by` to `auth.users`, `SET NULL` for availability/notification rule creators and role creators, and `SET NULL` for license owners. The migration route handles these explicitly in D1 instead of relying on cross-database foreign keys. Rows without a source Auth foreign key, such as coupon usage and access analytics, retain their pseudonymous user ID as historical records.

Stripe cancellation, business D1, and Auth D1 cannot share a transaction. The order is password verification, source-constraint and eligible-license/transfer preflight, exact Stripe cancellation, idempotent per-license return, atomic business cleanup, then Auth deletion. If Stripe partially cancels multiple subscriptions or a later business cleanup/Auth deletion batch fails, Auth credentials and sessions remain for retry, which re-reads Stripe state and continues from remaining active licenses. A concurrent session revocation, expiry, suspension, or password change is respected; retry then requires a valid login and current password. A transfer created concurrently after preflight can still cause a partial license return followed by a 409; the account remains and a retry after the transfer is resolved completes the process.

Pending lottery cancellation records `LOTTERY_ENTRY_STATUS_CHANGED` for each
pending entry across all licenses, with a server-generated audit UUID, exact
actor/entry/action/type, old/new status, `user_request` reason, null request ID,
and the same captured time as cancellation. The shared
`lottery-cancellation-audit.ts` helper checks the pending snapshot before the
business batch and verifies each audit and final entry inside that batch.

`DELETE_ACCOUNT` likewise has a server-generated UUID and a same-batch guard
for the exact actor/resource/time/metadata and exactly one matching row. A retry
following an Auth failure preserves the accepted audit ID, original time and
metadata; duplicate or malformed retry audits refuse deletion. Missing,
suppressed, altered or deleted audits abort business cleanup. The previously checked customer/subscription projection snapshot is fenced before
cleanup, including shared customer ownership. Only checked projection values
may be deleted; a newly added or changed billing link remains and aborts the
batch. This is a D1 projection fence, not a transaction spanning Stripe.
Required deletes,
creator/winner nulling and ownership clearing are verified before commit.
Retained license/history/rule/foreign-role rows must still exist; deleting such
rows is not accepted as successful reference cleanup. A concurrent broadcast
reference or changed pending-entry snapshot also refuses the batch.

`account-deletion-auth.ts` rechecks the current password and authoritative
session, then fences that actor/session/credential against expiry, revocation,
suspension, password changes and credential ambiguity within one Auth D1 batch.
The user DELETE cascades to **all** sessions, provider/credential accounts,
TOTP factors, admin roles and MFA assurance. A final assertion in that batch
rejects incomplete cascades. This avoids the installed SDK's sequential
session/account/user deletes, which reproduced both false success on an ignored
user DELETE and credential/session loss on an aborted final DELETE. The
configured Auth instance has no secondary storage or user deletion hooks.
SDK sign-out runs after the committed cascade to expire each response cookie.
If cookie clearing fails, the already deleted identity still returns success;
a revoked D1 identity is never reported as a retryable deletion failure.

These are **separate** Business and Auth transactions. Already committed
per-license returns and billing cancellation cannot be rolled back by a later
batch failure. Business cleanup may already be committed when Auth refuses;
retry uses the retained credential/session and original deletion audit. The
native test suite loads all 25 canonical Business and four Auth migrations and
uses the real Worker router and Better Auth with synthetic users. Native proof
is distinct from deployment and remote acceptance.

## Verification

The current guarded candidate passes native **66/66**, existing Auth **47/47**,
frontend contract **4/4**, Worker typecheck, focused lint, workflow isolation,
and staging bundle dry-run. Code `388044b` passed both CI37092452003 jobs and was deployed as
`4a8d85dd-dfc4-424b-94ff-14354ae1fc4f` at100%. The six remote cases below
are accepted; broader provider/production acceptance remains separate. The pre-fix native run reproduced four failures (two missing
audit cases and Auth IGNORE/ABORT); separate billing-race reproduction returned
false 200 in both late-customer/late-subscription cases.

- `npm run test:account-deletion-d1` covers real Better Auth/D1 behavior with synthetic users, including Tier C return, audit/notification cleanup, pending-lottery cancellation, exact audit faults, suppressed cleanup/cascades, retained history, Auth/batch races, warmed-session invalidation, retry audit integrity, broadcast-FK and license-transfer preflight before Stripe, invalid password, Stripe-secret fail-closed behavior, anonymous denial, and the closed direct deletion route.
- `npm run test:stripe-account-deletion` covers test/live mode matching, cancellation confirmation, missing key custody, ambiguous identity, and retry after an uncertain Stripe response.
- `npm run test:account-deletion-api` covers the frontend request contract and rejects cross-origin Auth/API configuration without Supabase fallback.
- Current staging acceptance uses six actual Better Auth credential/session/HTTP cases: ignored/changed entry audit, ignored deletion audit, suppressed profile DELETE, and ignored/aborted Auth user DELETE. Failure503 preserves exact Auth credentials/session state. Four Business faults roll back cleanup; two Auth faults retain committed Business cleanup and the original deletion audit ID/time/metadata. Fault removal allows retry200, cookie expiry, exact audit/entry/retained-history readback and repeat401. Another user's session remains valid throughout. Fixtures use already returned grace licenses and omit pending delivery to isolate these boundaries; this does not prove a remote active-license return, populated billing or async-notification flow.
- Journal `fanmark-account-deletion-audit-15KPFs/canary.json` ends verified-and-cleaned: seven synthetic Auth identities and source Business fixtures removed, both-store FK0, exact Business/Auth trigger and baseline-creator restoration, cookies invalidated. Independent readback at2026-10-03T03:29:23.044Z confirms Worker4a at100%, source-owned Business/Auth0, ledger25, retained Master canonical3944/release7888/pointers/history, MFA generation236, three secret names and wake17:17. No schema DDL, real provider operation, user-data migration or DNS change ran. Private evidence: `/tmp/fanmark-account-deletion-388044b-staging-acceptance.json`.
- Historical simple deletion smoke used staging version `e64d6cd4-1cb0-4592-a4a2-276a648adf06`; it does not accept the new guarded candidate. A disposable synthetic Better Auth account signed in and deleted through the workers.dev API; exact remote readback showed zero Auth user/account/session rows and zero account-owned business rows. The deletion audit was verified, then the exact synthetic audit row was removed. No Stripe call or email ran.
- This does not prove imported Supabase credential compatibility, real Stripe acceptance for populated billing accounts, concurrent-transfer recovery under load, or production deletion. Production remains on Supabase until the separately planned final cutover.

## Signed cancellation after deletion (2026-10-06)

The actual Safari paid-test deletion reached guest state and removed its Auth
identity/accounts/sessions and business profile/subscription. Stripe confirmed
the exact test subscription canceled; the unlimited Tier C license was returned
to grace with no owner. Configurations remain during grace until expiry.

Its signed cancellation exposed a missing-mapping retry after user_settings was
deleted. Subscription reconciliation now accepts only an exact valid DELETE_ACCOUNT
audit plus a previously applied subscription for the same user/customer/mode,
with Stripe currently canceled and no active subscriptions. It atomically marks
the receipt ignored, dispatch completed, and releases the owned fence without
restoring a user projection. Missing/changed proof or suppressed writes fail closed.
Related webhook tests pass 79/79, including 22 subscription tests; staging
deployment, real receipt completion and fixture cleanup are pending at this checkpoint.
