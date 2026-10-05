# Availability-rule table and the current registration caller

This review resolves the rule-table behavior of the checked-in current
application. It does not change registration, prices or configuration and does
not claim that the deployed Supabase Edge body or arbitrary external callers
were read. File hashes and the separate captured SQL-reference scan are in
[the bounded review](evidence/source-availability-rule-consumer-review-2026-10-05.json).

## Source control flow

`supabase/functions/register-fanmark/index.ts` contains the sole checked-in
Edge consumer. Its private `checkPatternBasedPricing` helper selects only
`is_available=true`, ordered by priority. For well-formed configurations:

| Query or matching branch | Returned availability | Registration effect |
| --- | --- | --- |
| No rows / no matching rule | `true` | Allowed by this check |
| Specific, duplicate or prefix match | The selected row's `is_available`, therefore `true` | Allowed by this check |
| Count-price match | The selected row's `is_available`, therefore `true` | Allowed by this check |

The sole caller rejects only `!pricingInfo.isAvailable`. It never reads the
calculated `requiresPayment` or `priceUsd` to enforce payment. Consequently the
normal rule-table result cannot block or charge registration, including when a
well-formed rule is enabled. The earlier all-disabled observation is one instance
of this control flow, rather than its only explanation. Other registration
checks, including normalized input, tier, ownership and plan limit, retain their
own effects.

The previously captured SQL runtime catalog observed at
2026-10-04T23:39:31.1247+00:00 contains58 public function definitions, none with a
literal reference to `fanmark_availability_rules`. That is a bounded metadata
scan, not proof that dynamic SQL or external clients are absent. Source metadata
freshness remains documented in [the source refresh](evidence/source-current-readonly-refresh-2026-10-05.json).

## Target correspondence and acceptance boundary

The current D1 registration writer and availability repository do not consume
this table. For the reviewed valid-configuration source callsite this preserves
the existing absence of blocking/payment enforcement. The table and admin editor
remain migrated, with current-session admin MFA, bounded DTOs, compare-and-set
edits and no fallback. Existing client/Worker tests and staged TOTP edit/restore
acceptance are linked in [the admin contract](availability-rules-admin-api.md).
This review does not replace those runtime tests with static analysis.

These four availability/pricing configurations are distinct from the public
reference Master's reserved-pattern catalog. A ready-release row filter in that
public catalog does not make this rule table enforce registration.

Malformed historical JSON can throw in the source helper before its normal
return; this valid-configuration analysis does not establish malformed-input
parity. Such rows and unknown external consumers retain explicit disposition in
the final data/caller review. Enforcing a blocked pattern or an additional fee
would require a separate product rule and integration acceptance; it is not a
missing effect demonstrated by this source callsite. No speculative enforcement
is added during migration. Full runtime/authorization/converter gates remain
false.
