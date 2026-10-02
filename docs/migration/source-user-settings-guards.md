# Source user-settings privilege guards

The 2026-10-02 schema-only source catalog contains two native guards:

- `prevent_user_settings_insert_escalation`: service-role writes bypass the
  guard; other callers cannot INSERT the admin plan without `is_admin()`.
- `prevent_user_settings_privilege_escalation`: service-role writes bypass
  the guard; non-admin callers cannot change `plan_type` in either direction.

Cloudflare does not expose a user-authorized D1 SQL/table endpoint. Business
D1 is a server binding; product permission decisions belong to the Worker
operations. A browser session cannot choose a D1 `auth.role()`/`auth.uid()`.
Trusted CLI/provisioning/billing/admin writes correspond to source privileged
writers, rather than pretending SQLite implements PostgreSQL session RLS.

The reviewed caller-controlled paths are:

| Operation | Target control | Current evidence |
| --- | --- | --- |
| Own profile read/edit | `profile-d1-repository.ts` accepts GET/PATCH only and binds the session owner. PATCH accepts only display name, avatar and language. Plan, caller identity, billing and setup fields are rejected before writes. | Profile D1 10/10; forged admin plan/user/billing/settings leave both owners unchanged. |
| Signup profile creation | `invitation-signup-d1-api.ts` inserts `plan_type='free'` as a SQL literal after the captured Auth signup command/lease is validated. The client cannot provide a Business user/plan. | Invitation signup D1 10/10; unverified user + Free profile, retry/lease/conflict/consume-once coverage. |
| Qualified administrator plan edit | Admin user-management route requires the existing same-session role/MFA gate; the plan/enterprise/audit mutation is server-controlled. | Existing staging Free→Max→Free UI/API acceptance is separate from ordinary owner writes. |
| Provider billing reconciliation | Signed provider receipt/command paths apply allowed server-mapped plan transitions. A profile PATCH is not a billing operation. | Synthetic Stripe contract coverage exists; provider-backed acceptance is still pending. |

On 2026-10-03 the first two suites were rerun successfully (10/10 each).
This reviews those two source trigger contracts and their current owner/signup
paths; it does not clear the complete function/RLS/trigger catalog gate,
prove imported-user role mapping, or establish real billing/OAuth acceptance.
Any new caller-controlled user-settings write must preserve the same boundary.
No real user row was read, migrated or modified by this review.
