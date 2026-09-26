# Recent fanmarks Worker API contract

This documents the read-only recent-fanmarks API and frontend adapter for
issue [#33](https://github.com/kanouk/fanmark-id/issues/33). It has Supabase and
D1 Worker adapters plus an explicit frontend origin opt-in. It does not replace
the general Supabase client or constitute a complete migration. The app and
dedicated catalog Workers are deployed only on isolated `workers.dev` staging.
No production Worker route, public-domain cutover, or user-data import is
included.

## Source contract

The current `RecentFanmarksScroll` component calls the public
`list_recent_fanmarks` RPC with `p_limit: 20` and maps the generated RPC fields as
follows:

```text
id        = license_id || fanmark_id
emoji     = display_emoji || "❓"
createdAt = license_created_at
shortId   = fanmark_short_id
fanmarkId = fanmark_id
```

The checked-in Supabase definition returns `license_id`, `fanmark_id`,
`fanmark_short_id`, `display_emoji`, and `license_created_at`. The Worker
projects `fanmark_short_id` as `shortId` so both the landing ticker and search
page can keep their existing public-page link. User IDs, email addresses, and
other upstream fields are discarded. Rows without either an ID are skipped.
The response is capped at the requested limit after mapping, even if the
upstream response contains more rows.

## Endpoint

```text
GET /api/fanmarks/recent
GET /api/fanmarks/recent?limit=1..20
```

The default limit is `20`. The response is always an explicit versioned object:

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "license-or-fanmark-id",
      "emoji": "🌿",
      "createdAt": "2026-09-21T00:00:00.000Z",
      "shortId": "public-short-id",
      "fanmarkId": "fanmark-uuid"
    }
  ]
}
```

`Cache-Control: no-store` is returned for the API responses. Invalid, duplicated,
or out-of-range `limit` values return `400` without an upstream request. Other
methods return `405` with `Allow: GET, OPTIONS`. `OPTIONS` returns `204` and the
same explicit method allowlist. Unknown paths return `404`.

## Frontend selection

`src/components/RecentFanmarksScroll.tsx` and `src/hooks/useFanmarkSearch.tsx`
read the optional
`VITE_FANMARK_API_BASE_URL` setting through `src/lib/recent-fanmarks.ts`:

- unset or blank: keep the existing public Supabase RPC
  `list_recent_fanmarks({ p_limit: 20 })`;
- non-empty: call the Worker endpoint above and do not fall back to Supabase if
  the URL, request, status, timeout, or versioned response is invalid;
- Worker requests send only `Accept: application/json`, use
  `credentials: "omit"`, enforce a bounded timeout, and are aborted when the
  component unmounts.

The client accepts HTTPS origins and permits HTTP only for loopback development
origins such as `localhost`. It validates `schemaVersion: 1` and the public
`id`/`emoji`/`createdAt` item shape and optional `shortId` and `fanmarkId`
before updating the UI. A missing short ID never creates a broken `/f/` link;
the search screen uses `fanmarkId` for the existing lottery action.

`src/hooks/useFanmarkSearch.tsx` now uses the same loader with a limit of six.
It preserves the prior Supabase mapping when no Worker origin is selected, and
uses the Worker without a Supabase fallback once the Worker origin is configured.
Both frontend call sites abort their request when unmounted.

## Worker data-source adapters

`workers/api/src/repository.ts` contains the small typed
`RecentFanmarksRepository` interface and the Supabase implementation. When
selected, that adapter calls:

```text
GET {SUPABASE_URL}/rest/v1/rpc/list_recent_fanmarks?p_limit={limit}
```

The outbound request sends only `Accept: application/json` and `apikey`. It never
copies the incoming `Authorization` or `Cookie` headers, so this public operation
does not request or forward authenticated user data. A D1 adapter provides the
same public projection, and the backend is selected by RECENT_FANMARKS_BACKEND.
The staging Worker config now explicitly sets `RECENT_FANMARKS_BACKEND=d1`,
and the staging bundle points this client at the same-origin Worker. A remote
synthetic canary with two active and one grace license verified ordering,
filtering, mapping, limits, CORS/no-store behavior, and invalid-limit handling;
all inserted rows were deleted and read back as zero. With no business rows
present, the deployed endpoint now correctly returns an empty list. This is
staging-only evidence and does not replace the app's remaining Supabase APIs or
establish production data parity.

The adapter uses a five-second timeout by default. `SUPABASE_REQUEST_TIMEOUT_MS`
may override it for a controlled environment with an integer from `1` through
`30000`. The timeout remains active while the response body is read. Redirects
are requested in `manual` mode because Workers does not implement `redirect:
"error"`; every `3xx` response is rejected, so the adapter cannot follow a
cross-host redirect. Upstream failures return `502`, timeouts return `504`, and
configuration failures return `500` with a short code only. Upstream bodies and
exception details are never returned.

A separate read-only check of the existing Supabase RPC on 2026-09-21 used the
configured public anon key with `Accept: application/json`, without forwarding
an `Authorization` or `Cookie` header. It returned HTTP 200 and two rows with
the expected public RPC fields. This observes upstream compatibility only; it
does not verify a deployed Worker, target-account bindings, or frontend
adoption.

## Key and URL configuration

The fixture uses synthetic values in `workers/api/wrangler.jsonc`; it contains no
real key. A deployment or local `.dev.vars` file would need:

| Variable | Required behavior |
| --- | --- |
| `SUPABASE_URL` | HTTPS project root URL without credentials, query, hash, or an extra path. |
| `SUPABASE_PUBLISHABLE_KEY` | Preferred new key; must begin with `sb_publishable_`. |
| `SUPABASE_ANON_KEY` | Optional legacy fallback; only a parseable JWT whose payload role is `anon` is accepted. |
| `CORS_ALLOWED_ORIGINS` | Optional comma-separated exact origins. An incoming `Origin` must be listed; a request without `Origin` is allowed as a server request. |

`sb_secret_` values, legacy `service_role` JWTs, values containing
`service_role`, and arbitrary non-JWT values are rejected before any upstream
request. A `SUPABASE_SERVICE_ROLE_KEY` variable is never used as a fallback.
The allowlist does not treat `*` as a wildcard. An unlisted Origin returns `403`
before the upstream call and receives no permissive CORS header.

Supabase documents publishable keys as the low-privilege public key and secret
keys as backend-only credentials. Supabase REST RPC requests use the `apikey`
header; this fixture follows that boundary and does not put an API key in the
incoming user's bearer header. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers),
and [creating API routes](https://supabase.com/docs/guides/api/creating-routes).

## Local verification

Run from the isolated fixture directory:

```sh
cd workers/api
npm ci
npm run typecheck
npm test
npm run build:dry-run
```

The exact local proof dependencies are pinned in `workers/api/package.json` and
`package-lock.json`:

| Tool | Version |
| --- | --- |
| `@cloudflare/vitest-plugin` | `1.1.13` |
| `@cloudflare/workers-types` | `5.20260920.1` |
| `@msw/cloudflare` | `0.0.1` |
| `miniflare` | `5.20260918.0-alpha` |
| `msw` | `2.15.0` |
| `typescript` | `5.8.3` |
| `vitest` | `4.1.11` |
| `wrangler` | `4.135.0` |

The tests run the typed Worker handler in the local Workers runtime and use
`@msw/cloudflare` only to mock the outbound Supabase request. One test invokes
`exports.default.fetch()` with the bindings from `wrangler.jsonc`; the other
contract cases call the handler with explicit test environments so missing and
forbidden configuration can be exercised without mutating runtime bindings.
They cover the success/fallback mapping, explicit allowlist, default and
bounded limits, invalid limits without an upstream call, unsupported methods,
missing/forbidden keys, caller credential non-forwarding, extra-field
stripping, sanitized upstream errors, body-read timeout, and redirect
rejection.

From the repository root, the frontend contract tests run with the Node
standard test runner under the repository's Node `22.6.0` version and do not
add a test dependency:

```sh
npm run test:recent
npm run typecheck
```

They cover backend selection, URL validation, license-id precedence in the
Supabase fallback mapping, malformed Worker payloads and HTTP errors, omitted
credentials, request timeout, and unmount cancellation.

Cloudflare documents the `fetch` handler and environment bindings in the [Fetch
Handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/)
and [environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
references. The local test approach follows the [Workers Vitest test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
and [mock outbound requests](https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/)
guides.

## Explicit limits

This proof does not establish production Worker deployment, target-account
authentication, DNS/routing, secret provisioning, CORS policy approval, Supabase
availability, upstream latency, rate limits, or production API compatibility. It
does not establish that the frontend Worker setting has been configured in any
deployment or that the route is reachable from production. A later stage must
review the public projection, configure the target Cloudflare account, verify the
environment secrets and exact origin list, and perform staging/API acceptance
before enabling the Worker setting in a release.

## Live query definition readback (2026-09-21)

Direct read-only catalog inspection confirms that the source view selects active
licenses joined to fanmarks, uses the license display_fanmark and created_at,
and adds no separate expiry or fanmark-status filter. The security-definer RPC
orders created_at descending with a 1..50 limit; this API narrows the supported
public limit to 1..20. Equal timestamps have no specified tie order. Future D1
parity tests must retain these source semantics or record an explicit product
change. No user rows were needed for this inspection. See the
[object map](object-map.md) and
[reproducible metadata query](../../scripts/migration/recent-contract-readiness.sql).
