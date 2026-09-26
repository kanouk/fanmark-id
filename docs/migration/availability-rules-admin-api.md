# Availability rule administration on Cloudflare staging

## Scope and source data

The staging `AdminPatternRules` screen can read and edit
`fanmark_availability_rules` through the app Worker. The ordinary frontend
build keeps its existing Supabase path. `system_settings` is not exported as a
whole table; the registration limit is covered separately by the single
allowlisted `max_emoji_characters` setting.

A read-only Supabase query on 2026-09-26 returned four global rules:
`specific_pattern`, `duplicate_pattern`, `prefix_pattern`, and `count_based`,
in priorities 1 through 4. All four source rules had `is_available=false`.
The staging seed preserves rule IDs, JSON configuration, prices, descriptions,
and source timestamps. Top-level `price_usd` values are stored as integer
cents in D1. The `created_by` administrator UUID is intentionally omitted and
stored as `NULL`. This is configuration transfer, not user or Auth migration.

## Worker contract

- `GET /api/admin/availability-rules` returns a bounded, versioned DTO for up
  to 64 rules. It excludes `created_by` and returns `Cache-Control: no-store`.
- `PATCH /api/admin/availability-rules/:id` accepts either an availability
  toggle or a prefix-price update, together with the expected `updated_at`.
  D1 uses compare-and-set; stale updates return 409.
- Both methods require the Better Auth administrator authorization check and
  current-session MFA assurance. The API uses split business D1 and fails
  closed when the Worker selector or database is unavailable.
- Prefix-price edits are restricted to the three known prefixes (`🎄`, `🏢`,
  `💎`) and bounded USD text. The D1 value is updated atomically with its
  revision timestamp.

The Cloudflare staging build sets
`VITE_AVAILABILITY_RULES_ADMIN_BACKEND=worker`; the app Worker sets
`AVAILABILITY_RULES_ADMIN_BACKEND=d1`. Unset frontend configuration keeps
Supabase. Once Worker is selected, request failures do not retry through
Supabase. The Worker API is an admin editor; it does not establish Stripe
checkout, subscription, or payment-enforcement parity.

## Verification and limits

The local Worker suite covers MFA authorization, DTO bounds, route/method
guards, compare-and-set edits, stale revisions, and permitted price edits (4
tests). The frontend client suite covers backend selection, bounded DTO
validation, same-origin fetch, and no fallback on Worker errors (5 tests).
The workers.dev TOTP canary read all four rules, edited and restored a rule,
rejected a stale revision, and read back all four disabled with `created_by`
still `NULL`.

The staging D1 also contains the explicitly allowlisted public registration
setting `max_emoji_characters=5`, alongside `grace_period_days=1`. No other
`system_settings` row was copied by this slice. User data, production routes,
Stripe operations, and domain/DNS state are outside its scope.
