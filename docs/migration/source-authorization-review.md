# Source authorization catalog review

This is a read-only source inventory for the remaining authorization review.
It does not approve the complete RLS-to-Worker migration. D1 authorization must
be enforced by each server route and transaction; PostgreSQL grants and RLS
policies are not copied into public D1 access.

Latest read-only observation2026-10-03T04:12:13.485862Z retains all counts and
the authorization fingerprint below; all58 definition hashes also match the
separate runtime observation04:12:13.370671Z and v41. The new
[trigger counterpart index](source-trigger-counterparts.md) links source
settings owner policies/plan-escalation guards to profile allowlists, server-
selected signup plans, current-session MFA administration and verified billing.
Full25 Business/4 Auth own-profile native10 cases pass; its existing command
now joins normal CI;7a603bd CI37096588121 passed both jobs. Timestamp writer
correspondence is separately recorded for29 bindings, including internal SQL
writers and explicit import/claim/no-op differences. This is the named
application scope, not77-policy approval.

The [source access helpers](source-access-helpers-review.md) record the exact
username exclusion, user_roles helper, admin-plan helper and elevated-admin
definitions. Target adminRole authority/current-session MFA is deliberately
separate from a source plan or generic role-query RPC. Source is_super_admin's
missing-plan SELECT/IF NULL fallthrough is recorded by a literal read-only
five-case oracle; the target's existing native9 waitlist cases include missing
settings refusal and denial-audit persistence. Actual identity/role import and
operator bootstrap/custody remain explicit data/operational requirements.

## Complete policy-to-current-path inventory

[source-policy-counterparts.md](source-policy-counterparts.md) now binds all
77 exact policy identities/commands/roles/expression hashes to 40 current table
counterparts, implementation files, feature contracts and existing coverage.
This closes the missing policy inventory, not full authorization acceptance.
It records the active finite source profile INSERT versus perpetual target
correction, participant ownership, session-only notification owner, server-side
billing writes, private password storage and deliberate Auth D1 role/MFA model.
Uncopied raw row/ALL surfaces and external consumers remain explicit. In
particular, existing reference DTO tests include inactive pattern/price members;
selected release is not row activation, and source active-only visibility still
requires disposition. Historical-owner analytics also differs. These are named
semantic decisions rather than an unexamined 77-policy backlog.

## Reproduce the inventory

`scripts/migration/source-authorization-bindings.sql` runs one `BEGIN READ ONLY`
transaction against PostgreSQL catalogs. It reads public relations, RLS policies,
view options, function definitions/types/ACLs and effective privileges for
`anon`, `authenticated` and `service_role`. It selects no application or Auth rows.
Verify the linked source project before running the pinned Supabase CLI. Keep
the raw result in a private directory/file: policy expressions and function
bodies can contain deployment constants. Do not paste raw output into a PR.

Generate a metadata-only report from that private query result:

```sh
node scripts/migration/source-authorization-review.mjs \
  --catalog /absolute/private/source-authorization-query.json \
  --output /absolute/private/source-authorization-review.json
node --test scripts/migration/test-source-authorization-review.mjs
```

The report validates required coverage, all three API roles, boolean effective
privileges, unique signatures/grants/policies and policy relation references.
It hashes policy expressions and function definitions instead of exporting them.
It records table privileges separately from RLS and distinguishes trigger/event
trigger functions from ordinary functions/procedures. Empty ACLs are not replaced
with PUBLIC privileges. File output is atomic/mode 0600 and cannot alias input.
The fingerprint is independent of observation time and catalog ordering.

## 2026-10-03 source evidence

Observation `2026-10-02T21:03:48.240925+00:00`, private directory
`fanmark-source-authorization-AoCi1r/{query,review}.json`:

| Catalog fact | Result |
| --- | --- |
| Relations | 40 tables and one view |
| Table RLS | Enabled on all 40; not forced |
| Policies | 77 |
| Public functions | 58: 13 trigger functions and 45 non-trigger functions |
| Security definers | 52 across all 58 functions |
| Effective EXECUTE including triggers | anon 40 / authenticated 40 / service_role 56 |
| Effective EXECUTE excluding triggers | anon 39 / authenticated 39 / service_role 44 |
| API-role RLS bypass | service_role true; anon/authenticated false |
| `recent_active_fanmarks` view | `security_invoker=true` |

Authorization fingerprint:
`8e9859a0fe06eb1e7b123f55f3cde2c1ae482081ed6912dd9dbc53a7452cd273`.
All 58 function-definition SHA-256 values match the earlier runtime binding
snapshot `fanmark-source-bindings-KhOjiA`; this comparison does not make the two
separate observations a single atomic snapshot. The older aggregate-only
authorization snapshot lacks function types and view options and is superseded
for classification by this complete catalog query.

Neither 40 nor 39 is a count of accessible business actions or vulnerabilities.
EXECUTE privileges alone do not prove PostgREST exposure or that function-body
checks allow an action. Trigger-returning functions require trigger invocation.
Table grants alone do not override RLS. A view's privileges/options need its
underlying-query and policy review. Source function bodies and each target API's
allowed input/owner/role/MFA conditions remain part of acceptance.

## Concrete counterparts checked

- Source `is_admin()` derives the caller from `auth.uid()` and checks the admin
  plan; `is_super_admin()` additionally checks a recent source Auth session.
  Worker administration checks the server-side Better Auth session, Auth D1
  admin role, verified factor and MFA assurance for that exact session. Existing
  Auth integration tests cover ordinary-user rejection, missing enrollment,
  another session without assurance, expired assurance and ambiguous factors.
  These are explicit migration gates, not client-provided role checks.
- Source `get_unread_notification_count(user_id_param)` uses a supplied UUID
  when present; its EXECUTE grant includes anon/authenticated. The target
  `/api/me/notifications/unread-count` intentionally obtains the owner only
  from the session and rejects all query parameters. The new local native-D1
  regression gives two users different counts (1 and 2), verifies both sessions,
  rejects `userId`, `user_id` and legacy `user_id_param`, refuses anonymous reads
  and checks that the other user's notification rows remain unchanged. No source
  RPC was invoked with real user IDs and the source function was not modified.
- Source individual/bulk notification read functions require the caller's
  identity and ownership. Existing target tests read back both users' rows and
  verify refusal of foreign notification updates and preservation of pending,
  expired, already-read and foreign rows during bulk read.
- Fresh source complete-data/availability/secure-availability/combined-lottery
  definitions were reviewed against the actual target search SQL. New local
  native D1 tests apply all 25 canonical Business migrations and exercise real
  Better Auth sessions through the Worker router, owner-specific pending
  entries, anonymous projection, rejected caller-selected identities and
  microsecond lifecycle boundaries. Source latest-license and earliest-blocker
  ordering remain distinct; target search never selects config content.
  Twelve cases pass. Combined-RPC external callers and NULL-end history ties
  remain unresolved; see [search evidence](fanmark-search-api.md).

These focused counterparts are not acceptance for all 77 policies or 45 ordinary
functions. The report retains `authorizationReconciled=false` and
`deployable=false`. Continue the per-object body/policy/caller/transaction review
using `object-map.md`, `frontend-callsite-map.md` and the feature acceptance docs.
Real user/Auth migration and domain cutover remain excluded.

Historical checks when the earlier focused evidence was added: authorization report 9/9, full
`test:migration-data` 266/266 (skip 0), native `test:notifications-d1` 16/16,
Worker typecheck, changed-file ESLint and workflow isolation pass. At that earlier checkpoint, D1 Free daily
read exhaustion prevented a new remote editor preflight; these local checks do
not substitute for the pending deployed editor acceptance.
The notifications suite is now included in `test:api-contracts-d1`, and therefore
the Worker's `npm test`/Cloudflare validation CI, rather than remaining a manual
focused command only.
