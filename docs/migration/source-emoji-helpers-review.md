# Source emoji helpers and current application correspondence

The 2026-10-02 source definitions match the 2026-10-03 runtime catalog hashes:

| Source function | Definition SHA-256 | Current target |
| --- | --- | --- |
| classify_fanmark_tier(uuid[]) | 94f92531b85d33460cd6c4a708ffa240805181b46b0ee6576087a6fd5051104f | `workers/api/src/fanmark-tier.ts`, called by availability and registration |
| normalize_emoji_ids(uuid[]) | 721c1dacd251704445209a72ea06c2e9e00812d3308182aeb7a23317b6fa48fb | Active-Master ID mapping in registration, favorites/search recording and public access |
| count_fanmark_emoji_units(text) | 931a36364bce6ec8c8bdd8870fe104360e8513b42024d57548a1e5d9eccde55c | No captured executable frontend/Edge or other source-function caller; current APIs count catalog IDs |

## Classification

For one to five canonical ordered IDs, source and target select tier 4 for one
ID, tier 3 for two IDs or two to five identical IDs, tier 2 for three mixed IDs,
and tier 1 for four/five mixed IDs. Repetitions are retained. Classification
does not itself normalize IDs; both target callers validate input, lowercase
UUIDs and read the active tier row separately. Registration derives normalized
IDs from the active catalog before classifying. Availability expects the
caller-supplied canonical IDs and remains advisory.

The shared target function replaces two identical implementations. Prices,
display names and license days remain Master data, not classifier constants.
Availability's native D1 suite passes 10/10, including repeated three/four/five
IDs; registration passes 21/21, checking those repeated combinations persist
tier 3 and its finite 14-day license rather than an unlimited length-based
tier. These registration tests use the existing reduced Business fixture plus
0022 and an owner resolver, not the complete split-Auth integration schema.
Worker typecheck and focused lint pass. This is local proof; no new deployment
or remote acceptance is implied.

## Identity and display

Source normalization removes the five exact uppercase codepoint strings
1F3FB–1F3FF and looks up the resulting ordered codepoint array. It retains
variation selectors, ZWJ, order and repetitions. Missing/unresolved mappings
or changed cardinality return NULL. Target active-Master mappings preserve
those rules and refuse ambiguous identities. Availability additionally strips
skin-tone Unicode characters from the display string; this is distinct from
canonical ID lookup, as documented in [availability](availability-contract.md).
Registration checks the submitted display against ordered catalog emojis and
rejects a forged normalized-ID assertion.

The source text counter removes FE0F and skin tones, then subtracts the ZWJ
count from the remaining non-ZWJ codepoint count, clamped at zero. It is not a
general grapheme counter. Porting this unused raw-text function into active
ID-based classification would change the current contract; no such endpoint
is added. Its ordinary source-function status does not establish that external
legacy consumers are absent.

## Remaining scope

Public APIs reject empty, NULL, malformed and over-five ID lists before the
classifier. Raw PostgreSQL array/NULL/multidimensional behavior is not exposed
as a compatibility API. Historical/noncanonical Master rows, legacy external
consumers, source ACLs and sequence-index semantics retain their separate
review/data boundaries. This review does not close the complete source audit,
final-schema importer or final integration.
