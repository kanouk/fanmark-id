# Source access helpers and current application callers

Reviewed against runtime catalog2026-10-03T04:12:13.370671Z. The four exact
definition hashes below match v41 and the latest runtime observation. This is
the current application's correspondence, not approval of all77 policies or
an assertion that ordinary unbound functions are inactive.

| Source function | Definition SHA-256 | Source behavior | Current target |
| --- | --- | --- | --- |
| check_username_availability_secure(text, uuid) | 96a9b815f6c6d6ef6adcd920af20924867b6980b91b5022e5db9e2adc9b88bdd | NULL/empty candidate returns false. Compares stored username to lower(candidate), excluding the supplied UUID or the nil UUID when omitted. Does not reserve a name. | username-availability-d1-api.ts uses the same stored-name comparison and excludes the Better Auth session owner. It exposes only availability; arbitrary owner exclusion and anonymous account lookup are not exposed. |
| has_role(uuid, app_role) | 5506e560b7779ac4ef2d9a656aafe3e24b4e036121464e60dec1008af8f05acb | SECURITY DEFINER existence check in user_roles for the supplied UUID/role. Distinct from the admin-plan test below. | No executable frontend/checked-in Edge caller or captured policy/function reference was located. No generic Worker role-query endpoint is added. Administrator authority instead uses the server-managed Auth D1 adminRole table. This is not a declaration that legacy/external RPC consumers do not exist. |
| is_admin() | 916d2d00836f723c79756271c71aa7c9ab294b42b011ed71a82c1a2e0b97edaa | auth.uid() must be non-NULL and its user_settings.plan_type must equal admin. | index.ts authorizeAdminRequest reads adminRole from Auth D1 and requires assurance for the exact current session and verified factor. Cloudflare AdminRoute and MaintenanceGate use the Worker session gate; they do not grant permission from an editable profile or billing plan. |
| is_super_admin() | 71b926d07b7f6279cfea4919dc05c7ed8b87dec8bb6d381835afc470a3ac30ec | Attempts an admin-plan lookup before checking any session created within four hours with non-empty aal and writing ADMIN_CHECK. The no-row lookup yields NULL; IF NOT NULL does not return early, so the recent-session path can continue without an admin-plan row. Non-empty aal is not an explicit aal2 requirement. | waitlist-admin-d1-api.ts first uses the central exact-session admin/MFA gate, then independently requires setting?.plan_type === admin. Missing/non-admin rows are refused. Qualified/plan-denied list/email operations retain ADMIN_CHECK plus access/denial audits. Earlier Origin/session/role/MFA rejection does not manufacture a source actor audit. |

## Exact source NULL branch and target refusal

The source's `SELECT true INTO is_admin_user ... WHERE plan_type='admin'`
is non-STRICT. A lookup with no matching row sets that variable to NULL, even
though it was declared with a false default. `IF NOT is_admin_user THEN RETURN
false` then does not run. PostgreSQL documents both
[SELECT INTO's no-row result](https://www.postgresql.org/docs/17/plpgsql-statements.html#PLPGSQL-STATEMENTS-SQL-ONEROW)
and [IF's true-only branch](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-CONDITIONALS).
This corrects the earlier shorthand that this source helper reliably required
the admin plan; the target must not copy its NULL fallthrough.

`scripts/migration/source-super-admin-null-oracle.sql` runs literal expressions
in a read-only PostgreSQL transaction. Five cases recorded at
2026-10-03T04:48:47.499457Z in
`scripts/migration/fixtures/source-super-admin-null.json` show the source
decision's non-admin/missing-plan recent-session branches evaluating true,
while the explicit plan predicate evaluates false. SQL SHA-256:
1fe0c8f40c24c92873f93bf56d7e50929a6486586f4dc4d5d3ce8ea3dc154df4.
This proves the literal decision expressions, not invocation of the stored
source function, exploitability through an actual source API, or real session/
policy/row conditions. No source function/audit was invoked and no user row
was read. Production Supabase remains unchanged.

The existing `workers/api/test/waitlist-admin-d1.test.ts` already refuses a
non-admin plan on list access and a missing settings row on email access,
checking their durable denial audits. Those9 existing native cases and the
separate qualified/denied staging rehearsal remain the target evidence; no
duplicate test or remote fault campaign is introduced for this code review.
The mocked test authorizer proves the downstream plan/audit guard, while the
actual central role/MFA gate has separate Auth-D1 and staged TOTP evidence.

## Caller and authorization boundaries

`src/hooks/useProfile.tsx` and `src/lib/profile-utils.ts` select the Worker
username check under the Worker profile selector. The legacy currentUserId
argument is not forwarded. Empty, own, other-owner and uppercase candidates,
anonymous callers, forged owner parameters, duplicate/oversized queries,
unsupported methods and bad Origin are covered by the existing full25
Business/4 Auth `workers/api/test/profile-d1.test.ts`. Its10 cases now run in
normal CI;7a603bd CI37096588121 passed both jobs. Usernames are read-only in
the own-profile PATCH, so an availability response grants no identity write.

`src/components/AdminApp.tsx` keeps the legacy Supabase branch but selects
CloudflareAdminRoute for Better Auth. `src/components/MaintenanceGate.tsx`
uses the same Worker administrator session state. SecureWaitlistAdmin selects
the bounded waitlist Worker routes and their elevated-plan check. Staging build
selectors come from `package.json` build:cloudflare-staging; they are not
inferred from the minimal `.env.cloudflare-staging` file alone.

The target administrator role is deliberately separate from plan_type and
the source's generic user_roles helper. Signup selects free and creates no
adminRole. Paid billing prices cannot grant administrator authority. Own-profile
writes cannot set roles or plans; named privileged routes invoke the central
authorizer. `workers/api/test/auth-d1.test.ts` verifies actual sessions and the
role/factor/assurance gate, including missing/expired assurance and a different
session/factor. Waitlist route tests and the staged qualified/denied canary
are recorded in [waitlist admin](waitlist-admin-api.md). Feature tests with a
mocked authorizer do not independently prove the central MFA gate.

Existing source administrators must be mapped to explicit target roles during
the deferred identity/data preparation, with operator custody and recovery
defined before real users or the public domain move. Importing an admin plan
alone does not grant a target administrator role. Synthetic canary role grants
are temporary test evidence, not production bootstrap or operator acceptance.

Source has_role remains an ordinary callable function on the unchanged source.
No captured current caller does not imply no dynamic/external caller. Legacy
RPC/SDK caller disposition remains part of the later cutover review; direct D1
table grants and generic source EXECUTE permissions are not public target APIs.
The complete policy-to-action reconciliation and operational role custody
requirements remain in [COMPLETION.md](COMPLETION.md).
