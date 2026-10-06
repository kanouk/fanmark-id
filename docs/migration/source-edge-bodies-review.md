# Deployed Supabase Edge bodies and checked-in preparation

## Read-only source proof (2026-10-06 JST)

The identified source project was read with Supabase CLI2.118.0. Its35 ACTIVE
functions were individually downloaded into separate private directories,
preserving each bundle's own shared files. The name/status/version/verify_jwt
inventory was identical before and after the downloads. No function was invoked,
source configuration changed, or application/Auth row read. Raw code/logs remain
outside Git in0700 directories/0600 files; public evidence contains only names,
versions, paths, byte counts and hashes.
[Complete bounded readback](evidence/source-edge-body-readback-2026-10-06.json).

Of35 entrypoints,31 match the reviewed checkout byte for byte. Of61 downloaded
file occurrences, the mismatches use six distinct paths: four entrypoints and
two shared helpers. All downloaded files match in24 function bundles. A bundled
file's presence does not establish that it is reachable from the entrypoint;
callsite/authorization review remains separate. Do not call the whole deployed
system identical to the checkout or the source semantics fully reconciled.

| Different entrypoint | Deployed version / current source behavior | Checked-in preparation and migration boundary |
| --- | --- | --- |
| create-extension-checkout |152. Reads Supabase extension prices and creates Checkout without the new durable intent/request contract. | Adds explicit request UUID and bounded month validation, a durable intent/session replay contract, price metadata and optional Cloudflare pricing. These Supabase changes are prepared locally, not present in the downloaded source. The separate Worker/D1 implementation has its own accepted test-only Checkout/extension evidence. |
| extend-fanmark-license |227. Reads Supabase tier pricing directly. | Adds the optional Cloudflare reference-pricing reader. This bridge is not a deployed production dependency. The Worker command and paid fulfillment retain separate authorization/application contracts. |
| handle-stripe-webhook |172. Retains the legacy handler, direct business writes and legacy customer lookup. | The checked-in receipt-first ingress, fenced application/retry and strict customer mapping are local Supabase preparation. Their presence does not prove source takeover. Cloudflare test-only signed delivery/application acceptance is recorded separately in COMPLETION. |
| manual-expire-grace-licenses |14. JWT gateway enabled; the handler creates a service-role client without an application admin-role/MFA check. | The POST/admin/current-session AAL2/paged recheck replacement is prepared locally and remains undeployed. Its downloaded return-helper variant also differs. Existing Worker lifecycle routes require their own administrator/MFA boundary; do not expose this legacy handler on Cloudflare or silently change production. |

The shared `admin-auth.ts` downloaded with the six ordinary admin functions and
`send-broadcast-email` uses the same source hash
`3085c68b2168b3f888761e7a1e15b655719e2719d124175b8d5b687a6bce371f`.
The checkout's optional current-session MFA extension has a different hash and
is not deployed there. `manual-expire-grace-licenses` also includes that shared
file in its bundle, but its entrypoint does not call it. Presence of the helper
does not give the manual handler an administrator gate.

## Registration rule consumer

`register-fanmark` version316 and both downloaded shared files exactly match
the checkout. The [availability-rule consumer review](source-availability-rule-review.md)
therefore applies to this actual deployed registration path, including its
valid-configuration non-enforcement of computed pattern fees/availability.
The download neither invokes registration nor reads rule/user rows. Malformed
historical configuration and arbitrary external consumers keep their own gates.

## Broadcast authorization

`send-broadcast-email` version36 has a matching entrypoint but the older shared
administrator helper. Syntax-tree comparisons (excluding comments/formatting)
confirm that its service-client constructor and `isAdminUser` match the checkout.
The latter checks `user_roles.role=admin`, not `user_settings.plan_type=admin`.
Its actual `requireAdminContext(req)` call validates the bearer user and role,
but the downloaded helper has no current-session MFA check.
[Bounded authorization proof](evidence/source-broadcast-authorization-readback-2026-10-06.json).

The Worker deliberately requires the server-managed Auth admin role, exact-session
verified MFA, and the Business admin plan. Its fixed-recipient test route also
refuses a caller-selected address, whereas the legacy sender accepts `testEmail`.
These are documented authorization/recipient-boundary changes. A later explicitly
approved fixed-recipient API test was Delivered and matched to its D1 audit;
[bounded acceptance](evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json).
Actual test-send UI, bulk dispatch, signed delivery/retry and retention remain
unaccepted. Auth verification/reset success does not close them. See
[broadcast contract](broadcast-email-admin-api.md).

## Reproduce without changing the source

Use a private0700 work directory with only the identified project link, set
`umask077`, and retain CLI output privately. Record `functions list --output json`
before and after downloads with the same pinned CLI and project. For each name,
use a fresh child directory so an older function's shared helper cannot overwrite
another bundle's version:

```sh
npx --yes supabase@2.118.0 functions download register-fanmark --use-api --project-ref ppqgtbjykitqtiaisyji --workdir "$TASK_PRIVATE_LINK_DIRECTORY" --yes
```

Compare every extracted file's bytes/hash with the exact checkout; never replace
the checkout from this download or treat prepared local changes as deployed.
This source-body inventory closes the metadata-only uncertainty for the35
identified Edge bundles. It does not close all SQL/RLS/trigger semantics,
external callers, real-user credential/data migration or final integration.
