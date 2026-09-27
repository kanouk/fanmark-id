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

The staging frontend currently selects the Worker route. The deployed Worker
version `28e7ca3c-f610-47a4-aea9-f876bd8c3f11` still has its manual selector
unset; a cookie-less request returned 401 before reaching the disabled-selector
branch, and its deployed variable readback showed no `LIFECYCLE_RUN_BACKEND`.
The current staging configuration now enables only the manual route with
`LIFECYCLE_RUN_BACKEND=d1`, an explicit lifecycle target/schema digest, and a
four-page cap. `LICENSE_EXPIRY_BACKEND` remains absent, so the daily Cron stays
disabled. The configuration passed its selector test and Wrangler dry-run,
but the updated Worker has not yet been deployed and the authenticated
zero-candidate staging canary remains pending. Until deployment, the running
Worker continues to fail closed with 503 and cannot fall back to Supabase.

## Validation

The frontend client suite validates selector defaults, same-origin
credentialed requests, strict aggregate response shape, and no fallback. The
Worker handler suite validates administrator/MFA authorization, origin,
method, query and body rejection, split business D1 selection, disabled
selector behavior, identifier stripping, sanitized errors, and bounded
continuation status. Live authenticated browser acceptance remains open; no
request has executed the lifecycle engine against staging D1.
