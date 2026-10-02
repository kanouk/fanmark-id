# Public profile and ownership runtime review

The catalog-only `public-profile-runtime-readiness.sql` transaction observed
the linked source at `2026-10-02T20:02:54.411923+00:00`. It captures six selected
function definitions, the current profile column shape and profile policy
expressions, without reading application/Auth rows. Raw output remains private
under `fanmark-profile-runtime-7fkpOj/query.json`. It is not a complete role,
grant, caller or external-consumer inventory.

## Source definitions and actual callers

The six definition SHA-256 values match the earlier full runtime catalog:

| Function | Definition SHA-256 |
| --- | --- |
| `get_fanmark_by_emoji(uuid[])` | `c98679a9e059a20f5824e008fcd4012e6f5af10965f3d087c545040c33bbcdef` |
| `get_fanmark_by_short_id(text)` | `d461f24f2513724556c080bb1ffc3035c265ee7a9ffbe47e315648514a43fabd` |
| `get_public_emoji_profile(uuid)` | `f0486111074007df437fe0cae78b8c88e4f471e03d2e4a22b1ca153e86c884c6` |
| `get_public_fanmark_profile(uuid)` | `3145b8ad0faae73233fdd1d9179a4adb5ad2349a983954674c615e9047604972` |
| `get_fanmark_ownership_status(uuid)` | `bacbc1b1f79f07a34c6594886fc3ce179536d759836d80f5417acd917929c788` |
| `is_fanmark_licensed(uuid)` | `2d7ff6ab60fbd419afd265359c3883d6b8a5b3e7c1a45efd00e55e8e39001097` |

`src/hooks/useEmojiProfile.tsx` and `supabase/functions/fanmark-ogp/index.ts`
call the license-ID `get_public_emoji_profile`. The Worker public profile and
OGP projection are its current counterparts, with the previously adopted
active/non-returned/public/password guards. The source RPC itself only checks
`is_public` and sorts by update time. Do not remove the target guards to copy
that weaker predicate.

The current `fanmark_profiles` columns are `id`, `license_id`, `display_name`,
`bio`, `social_links`, `theme_settings`, `is_public`, `created_at`, `updated_at`.
The separate `get_public_fanmark_profile` definition references
`fanmark_profiles.fanmark_id`, which is absent. No executable frontend or Edge
callsite for this legacy RPC was found; only generated type declarations
remain. This is structural incompatibility, not proof that no external client
calls it. Do not invent a `fanmark_id` column or publish a new compatibility
endpoint. External-consumer disposition remains open.

The two license-ID ownership helpers also have no executable frontend/Edge
callsite in the current repository. Their definitions use `license_end > now()`
and therefore do not count perpetual NULL-end licenses as active. No other
definition in the captured 58-function catalog mentions their names. Text
absence is not a complete dependency graph or runtime-usage proof; these
ordinary RPCs remain review items, unlike unbound RETURNS-trigger functions.
Do not use them as authorization helpers for the Worker.

## Perpetual owner profile correction

PRODUCT.md defines Tier C as perpetual and the Worker settings/public-profile
routes already support it. The owner profile API had copied the finite-only
source editor/INSERT policy, leaving perpetual owners unable to read or edit
their profile through the Worker. Both context read and INSERT/UPSERT selectors
now require the authenticated owner, active status, and
`license_end IS NULL OR license_end > captured_now`.

This is an explicit target correction. The live source INSERT policy still
requires a future finite end. Source UPDATE/DELETE policies check ownership
without that expiry predicate; the Worker continues to reject grace/expired
editing. Live source policies and the production-default frontend are not
changed. The separate public emoji/short-ID selection difference documented
in `public-access-contract.md` is retained and remains an unresolved product
gate; this correction does not silently change it.

The local authenticated split-D1 regression returned 404 before the correction
and passes after it. The 8-test owner-profile suite proves perpetual read,
update/recreation, exact display-name spaces, generation update, other-owner
refusal, grace/expired refusal, finite-plus-perpetual ambiguity, and native
grace transition at the write barrier with unchanged profile/generation.
The 14-test public-access suite includes future-by-one-microsecond acceptance
and exact/past expiry refusal. These are local synthetic proofs. Remote
perpetual-profile acceptance, the remaining runtime/RLS/trigger mapping,
provider/CPU/operational/mobile acceptance and external legacy RPC disposition
remain open. The full runtime report and converter gates remain false.
