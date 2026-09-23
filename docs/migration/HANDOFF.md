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
| Credential transform target profile | Current worktree | Exact local DDL for artifact/coverage tables is bound to the source catalog, lifecycle schema, generation triggers, and descriptor. Five Miniflare tests pass, including exact readback, no-op reapply, partial/changed/unexpected rejection. Importer still rejects credential catalogs; the isolated transform core still targets its synthetic schema and is not yet integrated. See docs/migration/credential-import-integration.md. |
| Active-to-grace source-shaped integration | Current worktree | Local-only repository now applies the source, lifecycle, generation-trigger, and descriptor-bound credential extensions to the same synthetic D1 profile. The expiry run stores and reads back the integrated extension digest. Eleven Miniflare checks pass, including read-only importer profile validation and fail-closed credential rejection, nullable owner, exact effect readback, lost acknowledgement, rollback/resume when mandatory effects are suppressed, stale fanmark, notification display/link, and strict expiry boundary. It uses a five-source-table subset; the complete 40-table profile, credential row importer, grace-to-expired, cron/API, and remote checks remain open. See docs/migration/lifecycle-schema-integration.md. |
| Credential descriptor | `59a02f1` | Six-column mapping and schema/codec policy checks. No row transform/import connection. |
| Credential import projection | `ddcbfea` | Source snapshot row/hash/PK validation and private one-use credential input; migration-data suite 74 passed with actual 40-table metadata plus one synthetic row. Generic importer still blocks credential-bearing snapshots. |
| Local Better Auth/D1 proof | `docs/migration/auth-feasibility.md` | Better Auth 1.7.5 + bcryptjs 3.0.3 verified synthetic `$2a$10$`/`$2b$10$` password, UUID/session, and TOTP flows under workerd. No real Auth rows or hashes were exported. |
| Emoji master D1 staging/API/frontend | Current worktree | Two independent read-only exports of the 3,944-row public master matched and all rows staged/read back in disposable local D1. A private pointer has identity-guarded promotion/rollback. A paginated read-only D1 API and opt-in frontend selector now consume it locally; 7 release tests, 3 API tests, 5 client tests, 1 conversion test, typechecks, Worker-selected build, and dry-run pass. No remote D1 binding, deployment, or public activation. See `docs/migration/emoji-releases.md`. |
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

1. Continue the basic local/staging application and infrastructure slice
   under #34: finish integrated D1 schema/importer validation, connect the
   expiry work to the full synthetic target profile, complete remaining
   Workers + Static Assets routes/jobs and synthetic Auth integration, and
   run focused permission/parallel-operation checks. The active-to-grace
   source-shaped subset now has a local proof, but no production rows or
   service secrets enter these local proofs.
2. Continue #36's emoji-master path: the verified UUID-bearing release was
   built from two matching read-only exports of the authoritative public master
   and all 3,944 rows passed isolated local D1 staging/readback on 2026-09-23.
   A local private pointer and read-only API/frontend selector now support the
   release path with identity guards. Reconcile user-held references and use
   the local path in #37's synthetic rehearsal. Remote D1 creation/staging and
   deployment remain reserved for #38's final migration gate; no remote D1
   write, deployment, or public activation has occurred.
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
