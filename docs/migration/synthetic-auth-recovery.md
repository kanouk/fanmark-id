# Synthetic Auth D1 recovery

`npm --prefix workers/api run test:auth-recovery:d1` creates two isolated local
Auth D1 databases and runs the actual Worker router/Better Auth SDK. It does not
read staging/production identities or credentials, call external OAuth providers,
send email, change Worker secrets or migrate Supabase users.

## Snapshot and restore coverage

The source applies all four current Auth migrations: core0003, signup0007,
suspension0008 and OAuth0009. The fixture has three synthetic users, four accounts
(three real bcrypt credential hashes and one synthetic Google identity with token
fields), a real SDK-enrolled verified TOTP factor and encrypted backup codes.
Every one of the nine Auth tables is nonempty, including a live isolated session,
its exact-factor assurance, generation, role, suspension audit and verification
marker. Schema objects and every column of every captured row are compared.

The complete schema/data snapshot is sealed with AES-256-GCM and serialized to
JSON, then deserialized and decrypted before restoring to the second D1 binding.
Schema identity and a domain-separated hash of the matching `BETTER_AUTH_SECRET`
are bound to the authenticated metadata. Wrong archive keys, wrong schema,
wrong SDK secret and changed ciphertext are refused before target SQL. Restoring
over an existing target is refused without changing its contents.

Restore runs in one deferred-constraint D1 batch. It creates tables, restores
explicit row columns including the captured generation, then installs indexes
and triggers. Installing factor mutation triggers before the historical factor
rows would advance generation and invalidate saved assurance; they are installed
after rows in this isolated restore. Full schema/row equality and FK0 are checked.
The original source remains unchanged throughout all target checks.

## Actual restored application behavior

- The captured isolated session still identifies its user and its exact-session
  MFA permits the admin-session endpoint. Logout removes session and assurance;
  the old cookie then has no session.
- A new password login requires the existing restored TOTP factor. The old
  authenticator secret works, a new session is created and admin MFA succeeds.
- An encrypted restored backup code permits login and is consumed; its reuse is
  refused. The current admin assurance plugin grants assurance only after TOTP,
  so backup-code login alone does not grant admin access.
- Wrong passwords, unverified email and the suspended user are refused. Suspension
  and linked identity/token fields survive snapshot restoration.

## Key and operational boundaries

The installed Better Auth1.7.5 TOTP code decrypts `twoFactor.secret` with its
server `secretConfig`; backup-code storage is also encrypted by default. Restoring
the DB under an unrelated server secret cannot reproduce those factors. Keep the
matching SDK secret available alongside its ciphertext, using separate secret
custody from the snapshot encryption key. This rehearsal uses a public synthetic
SDK secret and a non-extractable in-memory encryption key; it does not establish
real secret custody or a durable key/archive backup.

The JSON serialization round trip is an in-memory archive proof, not filesystem,
off-host or remote D1 recovery. Real credentials, provider callback acceptance,
phone/browser MFA enrollment, operational retention/RPO/RTO and final combined
Business/Auth/Master/R2 recovery retain their own requirements.

Saved sessions and verification state are deliberately retained in the isolated
target to verify complete fidelity. This is not a production policy that revives
old sessions or resets a live generation. Production recovery requires an explicit
session/verification/assurance revocation and target-incarnation policy before
service resumes; do not apply this test helper to an existing environment.

The test config uses only dummy local database IDs and fixture credentials. The
command joins the normal Worker's `test:auth:d1`/`npm test` chain and is excluded
from the default fixture configuration so it cannot silently run against a
different schema. No deployed runtime changes accompany this test addition.


## Saved-file recovery and isolated Worker preparation (2026-10-06 JST)

The subsequent private rehearsal writes the complete synthetic source's nine
nonempty tables/14 rows and30 schema objects into an AES-256-GCM file. Its
schema identity and matching SDK-secret identity are authenticated metadata.
Archive bytes, one-off archive key and synthetic SDK/test credentials are mode0600
in private mode0700 directories, with keys separate from the archive directory.
The original source runtime is disposed before saved bytes are reopened.

The saved-file proof restores all columns/objects/hashes and FK0 into a distinct
native D1 in one45-statement batch; existing targets are refused before writes.
Wrong archive/SDK keys, schema and damaged bytes are rejected before target SQL.
The restored original session works, logout revokes it and its assurance, and
fresh original-password/TOTP login, backup-code consumption/replay refusal and
wrong-password/unverified/suspended refusal use the actual Worker router/SDK.
The saved archive remains unchanged. This proves local file persistence and
reopening, not adopted operational key custody or off-host retention.
[Bounded file proof](evidence/synthetic-auth-file-local-recovery-2026-10-06.json).

`isolated-recovery-auth-worker.mjs` is a temporary synthetic-recovery entrypoint.
Its exact recovery-name/incarnation/token gates precede a small method/path
allowlist. It strips recovery transport headers before calling the actual
application router. Signup, factor enrollment, account deletion and generic SQL
are closed. No recovery binding/route is added to the main staging Worker.
`test:isolated-auth-recovery` covers private gates, exact identity and real SDK
password login/cookies/logout; five native checks pass and join normal Worker CI.

A remote rehearsal must first verify both CI jobs at the exact candidate, the
fanmark account and main baseline. Create one new exact-receipt-owned Auth D1 and
one temporary guarded Worker, verify its database UUID/name, secrets' names,
incarnation, origin and100% version before application requests, then restore
only the saved synthetic snapshot. Verify every row/definition and SDK behavior,
delete owned resources by exact receipts and independently recheck the original
inventory/main DB hashes/Worker. Unknown write ACKs must not be automatically
retried. This preparation checkpoint preceded the accepted remote run below.

Saved isolated sessions are kept only to prove snapshot fidelity; expired MFA
assurance must remain refused. No production session revival or live generation
rewind is authorized. Operational revocation/incarnation policy, real credential
backup, providers, phone enrollment and final combined recovery remain open.

## Real D1 and temporary Worker saved-file recovery accepted (2026-10-06 JST)

At159f5c1, CI37407917794 completed both jobs successfully. The saved file above
restored all9 nonempty tables/14 rows/30 original objects/full columns/hashes/FK0
into one new isolated D1 in45 statements. No trigger SQL correction was needed.
Existing targets were refused before writes. Restore and target verification
took1144ms; resource creation/deploy, application checks, cleanup and operator
work are excluded, so this is not production RTO.

Exact target UUID/name, Worker bindings/secrets' names, origin/incarnation and
single100% deployment were verified. Token/incarnation controls refused invalid
requests; signup, new factor enrollment, deletion and generic SQL remained closed.
The actual router/SDK accepted the restored session and then-unexpired same-factor
assurance, revoked both on logout, refused stale cookies, and accepted original
password/TOTP login. Backup code was consumed once, replay refused, and backup
code alone did not grant admin assurance. Wrong password/unverified/suspended
users were refused. The archive remained unchanged.

Exact ownership receipts guarded deletion of the D1 and temporary Worker. An
independent read-only process at03:24:35.917Z verified their absence and original
inventory, all main Business/Auth/Master table counts/hashes/FK0, original3/7/2
Auth state and unchanged staging Worker8cbe1e5f. No main DB write/configuration
change, real Auth export, provider test, R2/DNS change or additional email occurred.
[Bounded remote proof](evidence/synthetic-auth-file-remote-recovery-2026-10-06.json).

This closes complete synthetic Auth saved-file/real-D1/login recovery. Operational
custody/rotation/off-host retention, production revocation/incarnation policy and
final combined recovery remain open. Keep actual user transfer in the deferred
stage. Do not revive old production sessions by following the fidelity rehearsal.

## Shared recovery implementation and explicit session policy (2026-10-06 JST)

`workers/api/src/auth-d1-recovery.ts` now supplies capture, AES-256-GCM seal/open
and empty-target restore. The native rehearsal imports this implementation
instead of maintaining its own restore/encryption functions. The accepted
`synthetic-auth-recovery-v1` authenticated envelope is retained; combined bundle
v2 remains a separate format. Nine Auth tables are read in one D1 batch with
schema/FK checks and a 20,000-row-per-table ceiling that rejects truncation.
This single-store read is not an atomic snapshot of the three D1 stores and R2.

Seal and open share a 32 MiB ciphertext ceiling, including the 16-byte GCM tag.
Seal checks the serialized UTF-8 plaintext size before encryption and JSON byte
array expansion, wipes that buffer and refuses an oversized archive with
`auth_recovery_archive_too_large`. It cannot report success for a file that the
reader would reject solely for size. This is a format ceiling, not a guarantee
that every archive below it fits a particular runtime's memory limit.

Restore requires the trusted expected schema hash, matching SDK key and an
explicit `sessionPolicy`. `isolated-preserve` additionally requires
`isolatedFidelity: true`. `revoke-local-sessions-and-challenges` restores no
`session`, `mfaAssurance` or `verification` rows, while keeping credentials,
factors, roles, suspension audit and generation intact. This is an available
policy choice, not adoption of a production recovery policy. Provider-token
revocation and cross-store incarnation/coordinator behavior remain separate.
An existing target, including a migration-ledger-only target, is refused.

The native test now uses three independent empty target bindings: exact fidelity,
local-session/challenge revocation, and committed-write/lost-ACK. It verifies
stale cookies/admin assurance refusal, fresh password/TOTP login, credential
preservation, actual transaction rollback on an invalid inserted column, and
no blind replay after a real commit whose response was lost. Wrong keys/schema,
tamper, weaker AES keys and missing/non-isolated preservation policies are
refused. The source is unchanged. The existing native suite (one integrated
case), Worker typecheck, focused eslint and workflow-isolation check pass.

No route, collector, scheduled backup, secret/configuration or remote resource
is added or activated. Durable key custody, off-host retention, operational
policy adoption and full combined recovery under that policy remain unfinished.
