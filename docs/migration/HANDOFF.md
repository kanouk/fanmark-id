# Cloudflare migration handoff

Checkpoint: 2026-09-21. The migration is **not complete**. PR #41 is open and
draft; the production source and deployed routes remain unchanged.

## Resume boundary

Use branch `codex/cloudflare-api-preparation` in the migration worktree. The
original checkout contains unrelated UI work. Use Node 22.6.0 explicitly;
the shell's default Node version differs.

The user requires at least 20% of the ordinary Codex allowance to remain.
The user authorized one further bounded unit after the 22% checkpoint.
At the latest check, 21% remained; that unit is now saved and no further
implementation units should be assigned without renewed budget headroom.
Finish verification and preserve the current work before that reserve is
consumed. Luna's separately displayed reserve does not establish that its work
cannot consume the ordinary allowance. Resume new units after a quota reset or
an explicit change to this constraint, checking live usage first.

## Verified implementation checkpoint

| Area | Saved change | Evidence and limit |
| --- | --- | --- |
| Credential descriptor | `59a02f1` | Six-column mapping and schema/codec policy checks; migration-data suite 70 passed. No row transform/import connection. |
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

## Next implementation sequence after the reserve permits it

1. Compose the complete import target profile: converted source schema,
   lifecycle objects, generation triggers, and credential artifact/coverage
   ledgers. Bind exact definitions and all extension identities to the import
   run. Do not introduce broad exceptions into the exact-schema validator.
2. Adapt the credential state machine to the original six-column
   `fanmark_password_configs` row. Separate immutable source bytes from target
   identity, retained license incarnation, and policy metadata. Store the
   prepared bcrypt result in the original credential column while preserving
   the other source values.
3. Remove the credential proof's explicit password-generation increment when
   connecting the canonical triggers. Read back the trigger-owned version;
   do not double-increment or reset newer versions during resume.
4. Bind ordinary values, prepared credential, coverage, resulting generations,
   and checkpoint into one guarded transaction. Preserve deferred disabled or
   inactive cases; they prevent complete reconciliation.
5. Re-run nonzero synthetic all-table import with interruption, concurrency,
   unknown acknowledgements, and independent value/type/PK/FK/coverage readback.
6. Connect active-to-grace and protected access to the same target profile and
   version authorities. Then complete the remaining business functions,
   Stripe effects, notifications, frontend/admin/OGP, and Auth migration.

The generic importer still rejects any snapshot containing the credential
column with `credential_transform_required` before target mutation. Earlier
successful 40-table nonzero imports preceded this guard. Do not remove it
until the integrated transformed-row path and its failure tests are ready.

## Remaining external and release gates

- Correct CLI access to the target Cloudflare account and a reviewed Workers
  CPU/plan decision remain unresolved. No paid upgrade has been authorized.
- Real-data compatibility, encrypted backup/restore, source freeze/drain,
  Auth/OAuth/MFA transfer, R2 transfer, and single-writer cutover remain open.
- Local PostgreSQL and Miniflare results do not prove production parity or
  remote capacity. Read-only inventories do not implement RLS/trigger/function
  behavior.
- No DNS, production database, OAuth, Stripe, deployment, or public cutover
  change is authorized by this checkpoint. Keep PR #41 draft.

Detailed evidence and limitations are in [EXECUTION.md](EXECUTION.md),
[credential integration](credential-import-integration.md),
[lifecycle integration](lifecycle-schema-integration.md), and the corresponding
validation documents. Source values, private compatibility reports, and secret
material remain outside Git and must not be copied into issue/PR descriptions.
