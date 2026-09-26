# Cloudflare OGP route

`workers/api/src/ogp.ts` adds a staging-compatible OGP route for
`/a/:shortId`, the legacy `/:emojiPath` route, and `/api/ogp-image`. The Worker
handles crawler requests for both page routes and reads the public fanmark
projection from business D1. For emoji paths, it requires one exact active
`user_input_fanmark` match, then resolves the canonical `/a/:shortId` URL. An
ambiguous match fails closed to generic metadata. A public display name is
included only when the record uses `profile` access and
the shared public-profile projection confirms that the profile is published,
eligible, and not password protected. Protected records receive only the
emoji-based generic description. The route never reads owner IDs, password
values, redirect targets, or message content for OGP.

Non-crawler requests for either page route continue to Static Assets and the
SPA. The route uses the request origin to form canonical and image URLs, so a
workers.dev preview does not point metadata at the production domain. A future
custom-domain deployment will use that host from the request after the
separate domain stage.

The crawler HTML is `no-store` and `Vary: user-agent` because crawlers and
browsers share `/a/:shortId` but need different representations. The separate
SVG image can be cached for one hour in browsers and one day at the edge. SVG
emoji and display-name inputs are bounded and XML escaped; the HTML metadata is
HTML escaped. Staging adds `X-Robots-Tag: noindex, nofollow`.

Verification uses the synthetic public-access D1 fixture:

```sh
nodenv exec npm --prefix workers/api run test:public-access:d1
nodenv exec npm --prefix workers/api run typecheck
nodenv exec npx eslint workers/api/src/ogp.ts workers/api/src/index.ts workers/api/test/public-access.test.ts
```

The local D1 suite covers published and protected synthetic profiles,
emoji-path resolution and duplicate rejection, HTML/XML escaping, the browser
SPA fallback for both page routes, misses, and input limits. The route is now
deployed to the workers.dev staging app. Live checks passed for the crawler
fallback on the empty business D1 for short-ID and emoji paths, browser SPA
delivery, SVG generation, invalid image input, no-index headers, and the
existing Auth health route.
Because staging contains no public fanmark rows, live display-name and
protected-profile rendering remains proven locally only. No production
function, traffic, user data, or domain/DNS setting was changed.
