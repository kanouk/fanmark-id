# Workers Static Assets preparation

This is a local packaging proof for the phase 1 Cloudflare preparation in
issue [#33](https://github.com/kanouk/fanmark-id/issues/33). It combines the
existing recent fanmarks Worker with the Vite build through
`workers/api/wrangler.static-assets.jsonc`. It does not deploy a Worker, create
or change a Cloudflare resource, change DNS, or switch the frontend to a live
Cloudflare origin.

## Configuration

The preparation config is deliberately separate from the API-only
`workers/api/wrangler.jsonc`:

```jsonc
{
  "main": "src/index.ts",
  "assets": {
    "directory": "../../dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "run_worker_first": ["/*"]
  }
}
```

The `dist` directory must be built from the repository root before the local
asset tests or dry run. The package scripts check for `dist/index.html` to reject an absent build.
They cannot detect a stale build: rebuild first when running locally. The
application CI job runs these checks immediately after its fresh Vite build:

```sh
npm run build
cd workers/api
npm ci
npm run typecheck
npm test
npm run test:static-assets
npm run build:static-assets:dry-run
```

The checked-in variable values are synthetic fixtures. A staging or production
run still needs the target Supabase URL, a public publishable or legacy anon
key, an intentional `CORS_ALLOWED_ORIGINS` value, the target Cloudflare account
authentication, and a reviewed deployment environment. This config does not
claim that environment approval or protection rules are configured.

Cloudflare's Static Assets binding provides the `ASSETS.fetch(request)` runtime
API. This preparation uses `404-page` so the Worker can preserve a real 404 for
missing non-navigation assets and explicitly fetch `/index.html` only for a
navigation request. `run_worker_first: ["/*"]` is intentional in this local
packaging proof: the Worker owns both that navigation decision and the API
boundary. All asset requests therefore invoke Worker code; request usage and
CPU limits must be measured before choosing this routing for production.
See the [Static Assets binding documentation](https://developers.cloudflare.com/workers/static-assets/binding/),
[Worker script routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
and [SPA routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

## Request boundary

When the `ASSETS` binding is present, `workers/api/src/index.ts` passes
non-API requests to `ASSETS.fetch`. If that fetch is a 404 for a GET navigation
(`Sec-Fetch-Mode: navigate` or an HTML `Accept` header), the Worker fetches the
root `/index.html` shell. API paths are evaluated first and never pass through
the SPA fallback:

- `/api/fanmarks/recent` keeps the versioned JSON contract and Supabase adapter.
- Unknown `/api/*` paths return the Worker's JSON `404` response.
- `/api/auth/*` is also an API path and cannot become the React shell by
  navigating to an unknown auth endpoint.
- `/`, `/a/:shortId`, `/pwa`, and `/auth` receive the Vite shell. React's
  existing router resolves `/auth` after the shell loads.
- A missing navigation path receives the explicit SPA shell fallback. A
  missing non-navigation asset such as `/assets/does-not-exist.js` remains a
  non-HTML 404. A known asset such as `/favicon.ico` keeps its asset MIME type.

The local static asset suite runs through the actual `cloudflare:workers`
entrypoint with the local `ASSETS` binding. It covers the routes above, the
missing navigation fallback, the missing non-navigation asset, the known asset
MIME type, unknown API paths, known public API success, and a known API
upstream failure. The failure case asserts JSON rather than HTML so a backend
error cannot be hidden by the SPA fallback.

The same package script then starts a local `wrangler dev --local` process and
uses HTTP requests against it. That smoke test is the evidence for the outer
Workers asset router and `run_worker_first` behavior; the Vitest entrypoint
test alone would bypass that outer router. It does not contact a remote
account or Supabase.

## Remaining parity gates

The Vite build and local Workers binding do not establish production parity.
Before any staging or production cutover, the following behavior needs an
explicit decision and observed verification:

- OGP and social previews, including whether the current `og-image.png` and
  metadata need a request-specific or dynamic response.
- Admin subdomain routing and the existing `useSubdomain`/`AdminApp` behavior;
  no admin hostname, wildcard route, or account setting is inferred here.
- Supabase Auth callback, cookie, redirect, and session behavior at the chosen
  origin.
- Custom-domain, cache, security-header, service-worker, and PWA update
  behavior at the actual staging hostname.
- Any public routes or redirects outside the routes inspected in the current
  Vite application.

Until those gates are reviewed against a target staging origin, this remains a
deployable local packaging proof rather than a full frontend cutover.
