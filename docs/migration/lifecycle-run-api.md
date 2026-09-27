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

The staging frontend currently selects the Worker route, while the staging
Worker's manual selector remains unset. The Worker and frontend were deployed
as version `28e7ca3c-f610-47a4-aea9-f876bd8c3f11`; a cookie-less request to the
route returned 401 before reaching the disabled-selector branch. Wrangler's
deployed variable and secret-name readbacks show no `LIFECYCLE_RUN_BACKEND`.
The authenticated button therefore fails closed with 503 until the server-side
gate is deliberately enabled. This prevents the staging admin screen from
triggering Supabase's production Edge Function.

## Validation

The frontend client suite validates selector defaults, same-origin
credentialed requests, strict aggregate response shape, and no fallback. The
Worker handler suite validates administrator/MFA authorization, origin,
method, query and body rejection, split business D1 selection, disabled
selector behavior, identifier stripping, sanitized errors, and bounded
continuation status. Live authenticated browser acceptance remains open; no
request has executed the lifecycle engine against staging D1.
