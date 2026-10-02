# Source runtime bindings review

Scheduled writers are separately observed by a metadata-only read-only query;
see [source scheduled writers](source-scheduled-writers.md). Trigger bindings,
ordinary-function privileges, current Cron state and invocation history are
distinct scopes. Missing direct Cron mentions do not classify an ordinary
function as inactive or retire an external caller.

`schema-readiness.sql` captures triggers whose **table** is in `public`. It
does not capture a public function attached to `auth.users`. Runtime migration
review therefore also uses `scripts/migration/source-runtime-bindings.sql`, a
catalog-only `BEGIN READ ONLY` transaction that collects all public functions,
public-table triggers, public-function triggers in any table schema, and public
function event-trigger bindings. It selects no application or Auth user rows.

The fresh linked-project readback at `2026-10-02T19:45:33.736244+00:00` found
58 functions, 37 registered triggers and no public-function event triggers.
All 58 function definitions have the same SHA-256 as the v41 catalog observed
at `2026-10-02T14:21:25.605664+00:00`. The additional binding is enabled `O`:
`auth.users.on_auth_user_created` -> `public.handle_new_user()`.
Its definition SHA-256 is
`0da996fbca2881e1359d414ec2e0123466a0e9223b7157e83b0c5fc0cf3d1500`;
the function SHA-256 is
`09d55e8ddc314623b0fb0ac876d0e5c57ff8f444d8d39493a3c27a80690007a9`.
Keep this provisioning dependency in the Better Auth/signup review; absence
from the public-table catalog is not evidence that it is inactive.

Four exact source definitions return `trigger` but have no registered trigger
or event-trigger binding in any captured schema:

| Function | Definition SHA-256 | Current disposition |
| --- | --- | --- |
| `log_profile_cache_access` | `c6f638475a8ec48dd0751e69bbab35566abc99e0afdb466aabfe474df3cbcd51` | Keep as unbound source definition; install no new logging trigger |
| `log_waitlist_access` | `9db34d104d15c6adee8d02b5db3f83435d1c6183e1b7182b595fcda791be5672` | Keep as unbound source definition; active waitlist RPC/manual audits are reviewed separately |
| `sync_public_profile_cache` | `04ae72969504489c3c2f3b71d82fb597e11bfc820e1fbc272fc0c4bbf679b18c` | Keep as unbound source definition; introduce no cache-maintenance trigger |
| `validate_display_name` | `e2a4293a7111d2e8ebc90b5db51acd8b555096efee742707c6f820e9645a22a5` | Keep as unbound source definition; introduce no automatic display-name rewrite |

`generate_safe_display_name` is an ordinary function and remains a separate
review item. Trigger absence does not automatically exclude ordinary RPCs.
The source's currently unbound display-name validator does not justify changing
the Worker profile PATCH contract, which preserves the supplied display text.
Likewise, the unbound waitlist logger does not replace the active waitlist
functions' audit effects already reproduced by the Worker.

## Reproducible classification

Collect with the fixed Supabase CLI and a private project-link directory for
the verified linked project. Keep raw query output mode 0600 in a directory
mode 0700: function bodies can contain deployment constants. Use an absolute
query-file path when specifying `--workdir`.

```sh
CI=1 npx --yes supabase@2.118.0 db query --linked --file "$PWD/scripts/migration/source-runtime-bindings.sql" --workdir "$TASK_PRIVATE_LINK_DIRECTORY" --output-format json --yes > "$TASK_PRIVATE_QUERY_RESULT"
node scripts/migration/source-runtime-review.mjs --catalog "$TASK_PRIVATE_QUERY_RESULT" --output "$TASK_PRIVATE_RUNTIME_REPORT"
node --test scripts/migration/test-source-runtime-review.mjs
```

The classifier accepts the direct catalog or the one-row Management API query
envelope. It emits only function signatures/return types/language/security/
volatility, definition hashes, trigger binding metadata and review disposition.
No SQL bodies appear in the report. Output is private and replaced atomically;
input/output aliases are refused before writing.

The four inactive dispositions require exact definition hash/type/arguments/
security metadata and zero registered bindings. New bindings, even disabled
ones or bindings in another schema, return the function to review. Incomplete
scope, missing known Auth binding, duplicate identities and dangling/malformed
bindings fail closed. Unknown functions remain pending. Observation time and
catalog ordering do not affect the runtime fingerprint.

Current value-free fingerprint:
`8ee600ced4b859664feba7e29c94b2166734473a40f920b0c8aef991be11b579`.
The report records four inactive definitions and 54 functions awaiting runtime
evidence linkage in this report. Existing counterpart implementations and
accepted rehearsals still have their own evidence; the classifier does not
automatically import those approvals. All 37 active/registered bindings also
retain their runtime review requirement. `fullRuntimeReconciled` and
`deployable` remain false and the schema converter's catalog gates stay open.

Focused tests pass 9/9 and the complete migration-data suite passes 257/257
with no skips, including scope omissions, external/disabled/event
bindings, source drift, unknown functions, output redaction, stable fingerprints
and non-destructive private CLI output. Continue with source/RLS/trigger-to-
counterpart reconciliation and provider/operational/mobile acceptance. This
step changed no runtime schema, Cloudflare deployment, source data, real-user
credentials, or domain/DNS.
