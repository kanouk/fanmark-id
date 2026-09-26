# Public availability contract for the next Worker slice

Parent issues: [#33](https://github.com/kanouk/fanmark-id/issues/33) and
[#34](https://github.com/kanouk/fanmark-id/issues/34). This contract is design
input for implementation; no availability Worker endpoint is added by this
file.

## Current source evidence

The read-only catalog query in
`scripts/migration/availability-contract-readiness.sql` rechecked four function
fingerprints on 2026-09-21. Each matches the coordinator's prior private
function-definition read: `check_fanmark_availability(uuid[])`,
`check_fanmark_availability_secure(uuid)`, `classify_fanmark_tier(uuid[])`, and
`normalize_emoji_ids(uuid[])`. No function was invoked by that catalog query.

`src/hooks/useFanmarkSearch.tsx` calls the public availability RPC with
`normalizedEmojiIds`; search recording is a separate side effect using the
original IDs. The migration must keep the read-only availability operation
separate from search analytics and registration.

## Observed availability semantics

1. Resolve each supplied emoji UUID through `emoji_master`, retaining order and
   repetitions. Missing IDs or an empty resolved string return unavailable with
   `reason: invalid_emoji_ids`. Invalid length returns `invalid_length`.
2. Concatenate the resolved emoji strings, removing only skin-tone code points
   U+1F3FB through U+1F3FF for the fanmark identity lookup. Do not strip variation
   selectors or ZWJ, sort IDs, or deduplicate repeated emoji.
3. Look up `fanmarks.normalized_emoji` by that normalized string. The source uses
   `LIMIT 1`; duplicate identities are an import/invariant gate, not permission
   for a target implementation to select an arbitrary owner.
4. If no fanmark exists, classify the supplied IDs into a tier and read the
   active tier row. The response includes `available`, `tier_level`,
   `tier_display_name`, `price`, and `license_days`. A missing active tier yields
   the source's `invalid_length` result; preserve this legacy behavior until a
   separate product change replaces it.
5. For an existing fanmark, a blocking license is either active with no end or
   an end strictly later than the operation time, or grace with
   `COALESCE(grace_expires_at, license_end)` strictly later than that time.
   An expired license is not blocking. This differs intentionally from the
   recent-list view, which filters only status and ignores license end.
6. The source selects the blocking license with the earliest blocking-until
   time, with NULL last. If blocked by grace, return `reason: grace_period` and
   its available-at time; if blocked by active, return `reason: taken` and a
   null available-at time. The existing-fanmark response also contains
   `fanmark_id`, `blocking_status`, and nullable reason/available-at fields.
   It never needs to expose the license ID, owner UUID, password, or draft data.

Classification counts the supplied IDs: one emoji selects tier 4; two to five
identical IDs select tier 3; otherwise four/five select tier 1, three select
tier 2, and two select tier 3. Display names, price, and days come from the
active tier row. The function itself does not call `normalize_emoji_ids`;
the current caller supplies normalized IDs. Do not silently change the tier
algorithm while moving the backend.

`normalize_emoji_ids` is a separate internal mapping operation. It removes the
five exact uppercase skin-tone codepoint strings from each master row's
codepoints array and resolves the remaining ordered array back to a master
UUID. Missing/ambiguous mappings or a changed output cardinality return null.
This is not the same operation as Unicode normalization of the display string.
Existing master UUIDs remain authoritative during the initial data migration.

## Proposed Worker boundary

- `POST /api/fanmarks/availability`, JSON body `{ "emojiIds": ["uuid", ...] }`.
  Require one to five valid UUID strings, preserve order and repetitions, cap
  request bytes, and reject malformed JSON/type/length with a sanitized 400.
- A valid request returns a versioned envelope
  `{ "schemaVersion": 1, "result": { ...public availability fields... } }`.
  Domain-unavailable and unresolved master IDs remain explicit results, not
  transport failures. Allowlist the fields above rather than forwarding an
  arbitrary database JSON object.
- Public read-only access, exact configured Origin policy, no credentials in
  upstream public calls, no response/runtime caching, bounded timeout, and
  sanitized upstream errors. Do not retry a failed chosen backend against a
  different source.
- Preserve the existing frontend RPC path until an explicitly configured
  Worker build switches it. Do not combine this switch with analytics writes,
  registration, license acquisition, or changes to UI availability handling.
- A D1 adapter must use the imported master/tier/fanmark/license relations and
  preserve full timestamp precision. The backend's observed time is an input
  to the public calculation; the browser cannot choose an expiry time.

Availability is advisory. Registration must recheck identity, active/grace
blocking, user capacity, and uniqueness inside its own atomic mutation. A
positive public response is never an authorization to allocate a license.

## Required proof before connection

Use synthetic cases for missing IDs, 1/2/3/4/5-length tiers, repeated IDs,
skin-tone identity versus original display, ZWJ/variation selectors, inactive
or missing tiers, absent/existing fanmarks, active indefinite/future/exact-end/
past licenses, grace fallback/exact-end/past, and earliest blocker with NULL
last. Verify that expiry-sensitive search differs from recent-list behavior
only where the observed source contract differs. Freeze operation time in
those boundary tests and retain fractional timestamp precision.

A full D1 schema/import, uniqueness/foreign-key checks, canonical emoji catalog
publication, and atomic registration remain separate gates. These requirements
must not be replaced by a minimal fixture passing the read-only endpoint tests.
