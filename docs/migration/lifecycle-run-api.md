# Manual license lifecycle run API

## Contract

`POST /api/admin/license-expiry/run` replaces the admin expiration screen's
Supabase Edge Function call in Cloudflare builds. It accepts no query string or
request body and requires a Better Auth administrator session with the
existing same-session MFA assurance. The Worker passes the business D1
binding to the same bounded lifecycle engine used by scheduled execution.

The response contains only schema version, run status, candidate/processed/
conflict/page counters, the page limit, and elapsed milliseconds. It omits run
IDs, license IDs, row samples, and user data. Responses are `no-store`;
cross-origin requests are limited to configured app origins. The frontend
checks that the API and auth base share an origin and will not fall back to
Supabase after a Worker error. A bounded run that reports `in_progress` can be
resumed by invoking the route again.

## Independent selectors

The regular frontend defaults to Supabase. Cloudflare staging sets
`VITE_LIFECYCLE_RUN_BACKEND=worker`. The server route separately requires
`LIFECYCLE_RUN_BACKEND=d1`; unset or invalid values fail closed. This manual
selector is independent of `LICENSE_EXPIRY_BACKEND`, which controls scheduled
Cron execution. For a manual request only, the route passes a cloned Worker
environment to the lifecycle engine with `LICENSE_EXPIRY_BACKEND=d1`; it does
not change the live Worker environment or turn on Cron.

The staging frontend selects the Worker route. Staging version
`4988d9d0-b4ec-44d1-9ccc-00ac501aac36` now has `LIFECYCLE_RUN_BACKEND=d1`, an
explicit lifecycle target/schema digest, and a four-page cap. The scheduled
`LICENSE_EXPIRY_BACKEND` selector remains absent; the daily Cron schedule is
still configured but its handler exits before opening D1.

The first deployment of the manual selector returned 400 for an empty POST
because the edge runtime exposed its zero-byte body as a readable stream. The
handler now drains only until EOF or the first byte, with a one-second bound;
non-empty bodies remain rejected. Version `4988d9d0-b4ec-44d1-9ccc-00ac501aac36`
passed the authenticated synthetic TOTP/MFA canary. The endpoint returned 200
with aggregate-only zero-candidate results; both completed run journals were
read back against the configured target and digest, then removed. A separate
readback found zero profiles, fanmarks, licenses, lifecycle items/journals,
effect guards, and user-owned Auth rows. No real user data was present or
changed.

## Validation

The frontend client suite validates selector defaults, same-origin
credentialed requests, strict aggregate response shape, and no fallback. The
Worker handler suite validates administrator/MFA authorization, origin,
method, query and body rejection, zero-byte stream handling, split business D1
selection, disabled selector behavior, identifier stripping, sanitized errors,
and bounded continuation status (5 tests). Live authenticated browser
acceptance remains open; the synthetic API canary has executed and cleaned its
zero-candidate staging journals.
