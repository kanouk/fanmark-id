# Public waitlist signup API migration

The public waitlist form can use `POST /api/waitlist` when the frontend is
built with `VITE_WAITLIST_SIGNUP_BACKEND=worker` and the Worker explicitly sets
`WAITLIST_SIGNUP_BACKEND=d1` on split business D1. The normal frontend build
still defaults to the existing Supabase insert; a selected Worker failure is
reported to the form and never falls back to Supabase.

The route is public because it replaces the existing anonymous signup form.
When an `Origin` header is present, it must match the configured CORS allowlist;
the route accepts JSON, limits request bodies to 2 KiB, validates and trims
the address, stores it in lowercase, and bounds `referral_source` to 500
characters. New and duplicate
addresses both return the same `202 {"schemaVersion":1,"accepted":true}` so
callers cannot use the route to discover existing entries. The address is never
included in the response or an application log. The database insert is
idempotent on the unique email column.

The staging Worker uses a Cloudflare Rate Limiting binding with a limit of 120
requests per 60 seconds, keyed by a SHA-256 digest of `cf-connecting-ip`; the
raw address is not written to D1. This is a coarse staging burst limit, not a
global abuse-control or accounting system. Cloudflare counters are local to a
Cloudflare location and eventually consistent. IP-based keys can group people
behind shared networks, so the high threshold reduces but does not eliminate
that tradeoff. Cloudflare documents these per-location, eventually consistent
semantics and the shared-IP limitation in its [Rate Limiting API guide](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
Reassess the policy before enabling the route on a public production hostname.

Local verification uses synthetic data only:

- `npm --prefix workers/api run test:waitlist-signup-d1`
- `node --experimental-strip-types --test src/lib/waitlist-signup-api.test.ts`
- `node --experimental-strip-types --test scripts/migration/test-staging-selector-coverage.mjs`
- `npm run build:cloudflare-staging`
- `npx wrangler deploy --dry-run --config workers/api/wrangler.app-staging.jsonc`
- `npm run test:staging-waitlist-signup-smoke` (after deploying the staging Worker)

Staging canaries must use an `example.invalid` address, verify the generic
response and exact D1 row, then delete that exact row and read back zero. They
must not import existing waitlist data. Production remains on Supabase; no
real waitlist rows or domain/DNS settings are changed by this API slice.

The 2026-09-27 staging canary passed against Worker version
`9c54ceda-b840-482b-bc43-4c22e9c18923`: OPTIONS returned 204, an untrusted
Origin returned 403, new and duplicate submissions returned the same 202
payload, and the normalized synthetic D1 row was deleted and read back absent.
The waitlist count was zero before and after. The staging root returned
200/noindex and the deployed JavaScript hash matched local `dist-staging`.
GitHub run [36272821613](https://github.com/kanouk/fanmark-id/actions/runs/36272821613)
passed both Cloudflare migration validation jobs.
