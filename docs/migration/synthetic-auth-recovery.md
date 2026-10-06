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
