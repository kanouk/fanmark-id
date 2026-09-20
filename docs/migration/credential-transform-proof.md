# Credential transform local proof

This is a local feasibility proof for one migration-only credential row. It
does not read a source database, create a remote D1 database, deploy a Worker,
or change an application writer. All credential inputs and rows are synthetic
fixture data. The proof does not establish that the complete credential
snapshot has been imported or that the Cloudflare remote CPU limit is
acceptable.

## Reproducible fixture

The proof runs a real local Miniflare D1 database with the schema in
`experiments/cloudflare-auth/test/fixtures/credential-transform.sql`. The
transform is pinned to `bcryptjs` 3.0.3 at cost 10, matching the codec contract
in `docs/migration/credential-transform-design.md`. The local fixture keeps a
protected destination hash only for database assertions; the transform API,
safe artifact result, errors, and test report do not return or log the raw
input or hash.

Run it with the declared Node version:

```sh
cd experiments/cloudflare-auth
npm run test:credential-transform
```

The implementing agent and an independent Astra run with Node 22.6.0 each
passed all 17 tests on 2026-09-21, without skips. Astra also checked that the
core, fixture, and test file hashes were unchanged during its run.

## What the proof establishes

The synthetic row exercises the complete state sequence
`reserved -> prepared -> applied -> reconciled`. Its source envelope is
canonical and byte-bound to the source identity, target identity/incarnation,
license incarnation, codec policy, and source revision. Repeating the same
binding reuses the artifact and prepared bcrypt result; a changed envelope,
same-UUID license recreation, or target incarnation change fails closed.
Concurrent reservation attempts leave one artifact binding and one active
lease. A crash after reservation can resume the same artifact with a new fence.

The prepared hash is immutable for the rest of the state machine. A tampered
prepared hash is rejected before apply. The apply batch guards the current
lease/fence, active license, target incarnation, access configuration, and
generation, then changes the destination config, generation, and ledger
together. An injected batch failure leaves all three unchanged. An
acknowledged-unknown apply is recovered by readback without another bcrypt
calculation.

The fixture has two clock modes. Normal calls use SQLite's execution-time
`julianday('now')` expression in lease guards. The optional `testClock` is an
explicit deterministic hook used only by the local test harness. Tests delay
the real `prepare` and `apply` batch submission past lease expiry and verify
that D1 rejects them; a separate deterministic test covers an expiry between
the initial check and the final prepare SQL. This prevents a client timestamp
captured before bcrypt or queueing from extending a lease.

Reconciliation rechecks the current migration target/incarnation, license
lifecycle, access configuration, stored destination hash, enabled state,
transformation digest, and expected generations. The final applied-to-
reconciled update repeats those predicates in one SQL statement and requires
one changed row. A test mutates the target between the read and that update;
the stale result remains `applied` and is rejected. Re-reading an already
reconciled artifact also rejects an enabled-state mutation.

Invalid four-digit input and disabled rows are covered. Disabled rows remain
disabled and do not run bcrypt. Positive and wrong-input checks run for the
enabled synthetic transform. No OAuth, MFA, Better Auth account identity,
remote CPU measurement, source-format classification, or production writer is
proved by this fixture.

## Remaining migration gates

This proof is the row-level codec and D1 state-machine slice only. The next
unit must integrate the transformed-column descriptor into the general D1
importer while preserving UUIDs, non-credential columns, row coverage, and
the private immutable source artifact boundary. That importer integration is
not present here. Source compatibility rehearsal, remote bcrypt CPU/plan
measurement, single-writer cutover, and production lifecycle/authorization
readback remain separate gates. No re-enrollment shortcut or runtime
plaintext fallback is implied.

## Required incarnation authority

The retained license-incarnation row must exist in every target read and final
SQL guard. A missing row is never interpreted as incarnation zero. Parent
review added reservation and reconciliation-race regressions for this boundary;
the Node 22.6.0 credential suite now passes 19 tests with no skips. Removing
the authority between reconciliation read and final SQL leaves the artifact
applied, rather than incorrectly marking it reconciled.
