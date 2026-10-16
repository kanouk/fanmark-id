# Admin license expiry API

The Cloudflare staging admin user screen calls
`POST /api/admin/users/:userId/licenses/:licenseId/expire` when the Worker
backend selector is active. The route requires an authenticated administrator,
the current session's valid TOTP assurance, an allowed origin, and a
no-store response. It verifies that the license belongs to the path user and
accepts an optional reason up to 2,000 characters. An already-expired license
returns an idempotent success without another audit or event.

For a live transition, one business D1 batch conditionally sets `status` to
`expired` and updates `license_end`, `grace_expires_at`, and `excluded_at`.
The same batch removes the four access configuration rows, writes the
license-lifecycle and administrator audit rows, and queues a
`license_expired.v1` notification event. If any statement fails, the D1 batch
rolls back all effects. A compare-and-set guard rejects a concurrently changed
license rather than overwriting it.

The Worker regression suite covers ownership mismatch, anonymous denial,
state/config mutation, audit and event contents, repeated requests, and
rollback on a forced configuration-delete failure. The frontend client suite
covers request serialization and response mapping. The live staging TOTP
smoke combines expiry with suspension/restoration, verifies session revocation
and all expected D1 effects, exercises repeat safety, and removes the
synthetic rows. Independent readback confirmed the user-owned Auth/business
tables and the four configuration tables were empty after cleanup.

This path is enabled only on the isolated workers.dev staging app. Production
and default builds still use Supabase; no real license, user data, email,
Stripe request, or domain/DNS state was changed. Password-reset delivery,
populated-user acceptance, and integrated migration rehearsal remain open.
See the dated staging evidence in [migration execution](EXECUTION.md) and the
current checkpoint in [migration handoff](HANDOFF.md).
