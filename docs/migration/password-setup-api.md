# Cloudflare initial password setup

The Supabase product contract requires OAuth users to create an initial password. In the Cloudflare build, the authenticated user's `requires_password_setup` value comes from `GET /api/me/profile`; a failed or mismatched profile read keeps the gate closed.

`POST /api/me/password-setup` accepts exactly `{ "newPassword": string }`. It derives the user ID from the Better Auth session, requires a single business-D1 profile row whose setup flag is true, and enforces the same 8–128 character, lowercase, uppercase, digit, and special-character policy shown by the app before writing. It invokes Better Auth's server-only `setPassword` API; the server-only endpoint is not exposed through `/api/auth/*`. It then clears only that user's business-D1 flag and reads it back. Cross-database writes are not atomic: if the Auth D1 credential write succeeds but clearing the profile flag fails, retrying with the same password verifies that credential before completing the profile update. A different password cannot replace an existing credential through this setup route.

The route rejects untrusted origins, unauthenticated requests, unsupported methods, extra identity fields, malformed/oversized JSON, and attempts when setup is not required. All responses are `no-store`. Existing password changes use Better Auth's `/api/auth/change-password` endpoint and require the current password; the Supabase build retains its existing password-update flow.

The synthetic D1/API contract is covered by:

```sh
npm --prefix workers/api run test:profile-d1
npm run test:better-auth-client
```

These tests do not migrate real user credentials or prove live OAuth provider configuration. Staging version `8619222a-dba4-44b4-b085-685c69455c4f` was deployed on 2026-09-27; the unauthenticated setup POST returned `401` with `no-store`, and the `/password-setup` navigation returned `200` with `X-Robots-Tag: noindex, nofollow`. Live OAuth-provider acceptance remains unverified because provider credentials are not configured.
