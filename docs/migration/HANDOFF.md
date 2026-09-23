# Cloudflare migration handoff

Checkpoint: 2026-09-23. The migration is **not complete**. PR #41 is open and
draft; no production user-data import, public DNS cutover, or Cloudflare deployment
has been performed.

## Resume boundary

Use branch `codex/cloudflare-api-preparation` in the migration worktree. The
original checkout contains unrelated UI work. Use Node 22.6.0 explicitly;
the shell's default Node version differs.

On 2026-09-23, the user explicitly removed the old remaining-usage stop rule and
asked us to continue without reserving a percentage. Do not stop at 20% or 22%;
report only an actual service limit or tool rejection.

The current migration order is:
1. Build the basic Workers app/infrastructure in local or staging environments,
   using synthetic identities and data. Keep Supabase production as the sole
   business-data writer until the final operation.
2. Move only explicitly classified non-user master data, especially the
   versioned emoji catalog. Do not copy `system_settings` wholesale.
3. Complete integrated app/master-data rehearsal with synthetic users.
4. Import and reconcile real Auth, business, and user-owned Storage data only in
   the final operational phase tracked by #38. Existing Supabase sessions will
   require users to sign in again.
5. Switch public DNS/hostnames only after data and application reconciliation.
   Registrar transfer is a separate decision and is not required for DNS cutover.

The user says the user base is small and planned maintenance plus individual
support are acceptable. That can avoid overengineering for zero downtime; it is
not acceptance of account/entitlement mislinks, secret exposure, or data that
cannot be recovered. The old/new systems must not dual-write business rows.

## Verified implementation checkpoint

| Area | Saved change | Evidence and limit |
| --- | --- | --- |
| Credential descriptor | `59a02f1` | Six-column mapping and schema/codec policy checks. No row transform/import connection. |
| Credential import projection | `ddcbfea` | Source snapshot row/hash/PK validation and private one-use credential input; migration-data suite 74 passed with actual 40-table metadata plus one synthetic row. Generic importer still blocks credential-bearing snapshots. |
| Local Better Auth/D1 proof | `docs/migration/auth-feasibility.md` | Better Auth 1.7.5 + bcryptjs 3.0.3 verified synthetic `$2a$10$`/`$2b$10$` password, UUID/session, and TOTP flows under workerd. No real Auth rows or hashes were exported. |
| Emoji master D1 staging | Current worktree | Versioned public catalog is staged separately from canonical `emoji_master`; 4 local Miniflare D1 integration tests pass. No remote rows or public version activation. |
| Lifecycle target schema | `01a1507`, `8034735` | Exact source/extension DDL and fingerprint consistency; actual 40-table catalog applied to empty local D1. No production rows. |
| Credential incarnation authority | `7cf0fe6` | Missing retained authority is rejected by reads and final SQL; credential suite 19 passed. Isolated proof schema. |
| License/password generation triggers | `b6c85c5` | Seven triggers; schema/generation suites total four test groups passed; actual 40-table catalog plus extensions applied/reapplied/read back locally. Runtime disposal verified. |

These checks ran on Node 22.6.0 without skips. CI configuration isolation checks
passed, but the GitHub workflow remains manually disabled; local results are
not a successful hosted CI run.

The public-access proof also binds license incarnation separately from access
generations. Its same-UUID/equal-generation case rejects the old verification.
The apparent full-suite stall was traced to an outdated replay-test INSERT
that omitted the added column. After correction and removal of diagnostic
logging, the parent independently ran all 17 tests successfully in 4.33 seconds,
with identical source/fixture/test hashes before and after. This validates the
isolated proof; connection to the source-shaped runtime remains incomplete.

A subsequent bounded unit added `credential-import-projection.mjs`: canonical
snapshot records are checked with the existing row converter and record hash/PK
contract, then split into five ordinary bindings and a one-use opaque transform
input. Parent verification passed 74 migration-data tests, actual 40-table
metadata plus one synthetic row, and CI isolation checks. The generic importer
is still guarded. The integration design now requires a single six-column
INSERT assembled with the prepared hash, preserving NOT NULL and avoiding a
second trigger increment; deferred rows remain whole in the private source.

## Next implementation sequence

1. Finish the basic local/staging application and infrastructure slice under
   #34: deployable Workers + Static Assets shape, D1/R2 bindings, routes/jobs,
   Auth integration with synthetic identities, CI isolation, and focused
   permission/parallel-operation checks. No production rows or service secrets
   enter these local proofs.
2. Advance #36's emoji-master path: build a verified UUID-bearing release from
   the authoritative public master source and load it into isolated D1 staging.
   The current D1 tests use synthetic records only. Then implement reviewed
   promotion, API/frontend version selection, and rollback behavior while
   preserving user-owned references and stable UUIDs.
3. Complete the synthetic end-to-end rehearsal in #37 across the app, explicit
   masters, auth, storage, and billing sandbox. Exercise planned maintenance
   and individual support steps where that is simpler than zero-downtime
   machinery.
4. Only after those acceptances, finish #35's real-data snapshot/import tooling
   and run it in #38's final user-data operation: backup/restore, source freeze,
   Auth/business/Storage import, independent reconciliation, and documented
   handling for MFA/session and credential outcomes.
5. Switch public DNS/hostnames after reconciliation succeeds, then monitor the
   new single-writer environment. Keep registrar transfer separate.

The generic importer still rejects any snapshot containing the credential
column with `credential_transform_required` before target mutation. Earlier
successful 40-table nonzero imports preceded this guard. Do not remove it
until the integrated transformed-row path and its failure tests are ready.

## Remaining external and release gates

- Correct CLI access to the target Cloudflare account and a reviewed Workers
  CPU/plan decision remain unresolved. No paid upgrade has been made.
- Real-data compatibility, encrypted backup/restore, source freeze/drain,
  Auth/OAuth/MFA transfer, R2 transfer, and single-writer cutover remain open.
- Local PostgreSQL and Miniflare results do not prove production parity or
  remote capacity. Read-only inventories do not implement RLS/trigger/function
  behavior.
- No production database, OAuth, Stripe, deployment, or public DNS change has
  been made. The user's migration request covers the eventual cutover, but it
  stays at the final gate and begins only after the listed reconciliation and
  rollback checks pass. Keep PR #41 draft.

Detailed evidence and limitations are in [EXECUTION.md](EXECUTION.md),
[credential integration](credential-import-integration.md),
[lifecycle integration](lifecycle-schema-integration.md), and the corresponding
validation documents. Source values, private compatibility reports, and secret
material remain outside Git and must not be copied into issue/PR descriptions.
