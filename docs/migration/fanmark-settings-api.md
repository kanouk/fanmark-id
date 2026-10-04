# Owner fanmark settings API

This Worker/D1 slice covers owner reads and writes for the settings at
`/fanmarks/:fanmarkId/settings` and the owner-only settings load used by the
messageboard preview. Production remains on the existing Supabase path. On the
workers.dev staging app, both
`VITE_FANMARK_SETTINGS_BACKEND=worker` and
`FANMARK_SETTINGS_BACKEND=d1` are selected and the Worker route is deployed.

`GET` and `PATCH /api/me/fanmarks/:fanmarkId/settings` require a Better Auth
session. The Worker derives the user ID from that session, resolves the
fanmark's latest owned license, and never accepts a caller-supplied owner ID.
The read DTO contains the settings needed by the existing page but never
returns a stored password or hash. A read may report an inactive/expired latest
license so the page can preserve its current grace-state explanation; writes
require the license to be active and unexpired.

PATCH accepts only the fanmark name, access mode, its mode-specific redirect
URL or text, password-enabled state, optional four-digit password, and profile
visibility. It bounds the body and text, restricts URLs to HTTP(S) or a
telephone link, rejects unknown fields, and writes the related D1 rows in one
batch with an active-owner predicate on each write. Profile updates preserve
existing biography, social links, and theme fields. Old redirect/text rows may
remain, as in the source model, but only the selected mode is projected.

For a new or changed protected password, the Worker computes a
`bcryptjs@3.0.3` hash and stores it in the existing password-config column. The
raw value is never persisted in a client draft, returned, logged, or copied to
the migration ledger. Leaving an existing enabled password unchanged preserves
it. Enabling protection without either an existing password or a new four-digit
value is rejected. Disabling protection writes a fixed dummy bcrypt hash with
the enabled flag off.

Protected public reads need evidence that the stored hash can be verified.
Imported hashes use their immutable reconciled credential-transform artifact.
Later owner settings changes instead write a separate
`fanmark_password_runtime_evidence` row in the same D1 batch. That row stores
no password or hash; it binds the license incarnation, current password
generation, enabled state, codec, and timestamps. Verification accepts exactly
one matching evidence row. Generation, incarnation, enabled-state, or hash
changes invalidate stale evidence and fail closed. The verified-access schema
generator is now version 2 and has a strict v1-to-v2 upgrade path for the
single expected new table.

Local evidence:

- Worker synthetic split-D1 suite: `npm --prefix workers/api run test:fanmark-settings-d1` (6 tests).
- Frontend API contract suite: `npm run test:fanmark-settings-api` (5 tests).
- Protected-access suite: 10 D1 tests, including runtime evidence and stale-generation rejection.
- Full source-shaped D1 integration: 20 checks, including exact v1-to-v2 schema upgrade and readback.
- Worker and frontend TypeScript checks pass.

The live synthetic owner-settings canary passed against the deployed
workers.dev app: unauthenticated settings GET returned 401; authenticated GET
and PATCH returned 200; protected access with the wrong password returned 401;
correct verification returned 204; and the protected content read returned
200. The response omitted password/hash fields and hash-free runtime evidence
matched the current password generation. Cleanup read back zero synthetic
business and Auth rows. The verified-access schema extension was applied to
business staging under ledger migration `0004`; the business ledger is now
`0000` through `0004`. This does not prove password-format parity for real
users, Cloudflare CPU/plan fit under load, all browser interactions, or
production behavior. No real user data, production, or domain/DNS state changed.
