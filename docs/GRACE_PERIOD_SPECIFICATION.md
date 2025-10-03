# Grace Period Specification

## Overview
This document describes the grace period management system for fanmark licenses, implemented to ensure a consistent 48-hour grace period for both manual returns and natural expiration.

## Purpose
- Enforce a mandatory 48-hour grace period before a fanmark can be re-acquired
- Prevent immediate re-acquisition after manual return
- Provide clear visibility of when a fanmark will become available again
- Prepare the system for future extension and billing features

## Database Schema

### New Column: `grace_expires_at`
```sql
ALTER TABLE fanmark_licenses 
ADD COLUMN grace_expires_at TIMESTAMP WITH TIME ZONE;
```

**Purpose**: Explicitly tracks when the grace period expires and the fanmark becomes available for re-acquisition.

## License Status Lifecycle

### 1. Active Status
- **license_end**: The scheduled end date of the license (can be extended)
- **grace_expires_at**: `NULL`
- **excluded_at**: `NULL`
- **Description**: User has full access to the fanmark and can configure it

### 2. Grace Status
- **license_end**: Original scheduled end date (preserved for extension restoration)
- **grace_expires_at**: Date when grace period expires and fanmark can be re-acquired
  - Natural expiration: `license_end + grace_period_days`
  - Manual return: `now + grace_period_days`
- **excluded_at**: `NULL`
- **Description**: Fanmark is in grace period, configurations are still accessible but cannot be modified. Fanmark cannot be re-acquired by anyone.

### 3. Expired Status
- **license_end**: Original scheduled end date (historical record)
- **grace_expires_at**: Grace expiration date (historical record)
- **excluded_at**: Timestamp when license fully expired (grace → expired transition)
- **Description**: Fanmark is fully expired, configurations deleted, available for re-acquisition

## Grace Period Calculation

### Default Grace Period
- **Duration**: 2 days (48 hours)
- **Configured in**: `system_settings` table, `grace_period_days` setting

### Calculation Methods

#### Natural Expiration (license_end reached)
```typescript
grace_expires_at = license_end + grace_period_days
```

#### Manual Return
```typescript
grace_expires_at = now + grace_period_days
```

## Re-acquisition Rules

### Availability Check
A fanmark can be re-acquired if:
1. No active license exists (`status = 'active'`)
2. No grace period is in effect:
   - Either no `grace` license exists
   - OR `grace` license exists but `grace_expires_at <= now`

### Implementation
```typescript
// In register-fanmark edge function
const { data: existingLicense } = await supabase
  .from('fanmark_licenses')
  .select('id, status, grace_expires_at')
  .eq('fanmark_id', fanmarkId)
  .in('status', ['active', 'grace'])
  .maybeSingle();

if (existingLicense) {
  if (existingLicense.status === 'active') {
    return error('Already taken');
  }
  
  if (existingLicense.status === 'grace' && 
      new Date(existingLicense.grace_expires_at) > new Date()) {
    return error('In grace period', { available_at: grace_expires_at });
  }
}
```

## Edge Function Behavior

### return-fanmark
**Before**: Immediately set status to `expired`, delete configs
**After**: Set status to `grace`, calculate `grace_expires_at`, preserve configs

```typescript
// Calculate grace period
const gracePeriodDays = 2; // from settings
const graceExpiresAt = new Date();
graceExpiresAt.setDate(graceExpiresAt.getDate() + gracePeriodDays);

// Update to grace status
update({
  status: 'grace',
  grace_expires_at: graceExpiresAt,
  excluded_at: null
});
```

### check-expired-licenses
**Before**: Calculate grace expiration using `license_end + grace_period_ms`
**After**: Use `grace_expires_at` for direct comparison

```typescript
// Active → Grace (natural expiration)
const graceExpiresAt = new Date(license_end);
graceExpiresAt.setDate(graceExpiresAt.getDate() + gracePeriodDays);

update({
  status: 'grace',
  grace_expires_at: graceExpiresAt
});

// Grace → Expired
// Query: WHERE status = 'grace' AND grace_expires_at <= now
update({
  status: 'expired',
  excluded_at: now
});
// Delete all configs
```

### register-fanmark
**Before**: Check only for `status = 'active'` licenses
**After**: Check for both `active` and `grace` with future `grace_expires_at`

```typescript
insert({
  fanmark_id,
  user_id,
  license_end,
  status: 'active',
  grace_expires_at: null  // Explicitly null for new licenses
});
```

## Frontend Display

### Dashboard
- Show grace countdown when `status = 'grace'`
- Use `grace_expires_at` for countdown timer
- Display "Cannot be extended" during grace period

### Details Page
- History table shows `grace_expires_at` for grace licenses
- Shows `excluded_at` for expired licenses
- Shows `license_end` for active licenses

### Components Updated
- `GraceStatusCountdown.tsx`: Changed prop from `licenseEnd` to `graceExpiresAt`
- `FanmarkDashboard.tsx`: Added `grace_expires_at` to license queries
- `FanmarkDetailsPage.tsx`: Display logic updated for grace period dates

## Future Extensions

### License Extension
When implementing paid extensions:
```typescript
// Restore from grace to active
update({
  status: 'active',
  license_end: new_end_date,
  grace_expires_at: null,
  excluded_at: null
});
```

### Billing Integration
- Check `grace_expires_at` to determine if extension is still possible
- Prevent extension attempts after grace period expires
- Use `license_end` as the base date for extension calculations

## Migration Notes

### Backfill Strategy
1. Existing `grace` licenses: `grace_expires_at = license_end + grace_period_days`
2. Existing `expired` licenses: `grace_expires_at = license_end + grace_period_days` (historical)
3. New licenses: `grace_expires_at = NULL`

### Deployment Order
1. Run database migration (add column + backfill)
2. Deploy edge functions
3. Deploy frontend changes

### Rollback Considerations
- Column can remain even if feature is rolled back
- Remove feature by reverting edge function logic
- Column does not break existing functionality

## Performance Optimizations

### Indexes
```sql
-- Grace expiration queries
CREATE INDEX idx_fanmark_licenses_grace_expires 
ON fanmark_licenses(grace_expires_at) 
WHERE status = 'grace';

-- Re-acquisition checks
CREATE INDEX idx_fanmark_licenses_fanmark_grace 
ON fanmark_licenses(fanmark_id, status, grace_expires_at)
WHERE status IN ('active', 'grace');
```

## Testing Scenarios

1. **Manual Return**: Verify grace period is 48 hours from return time
2. **Natural Expiration**: Verify grace period is 48 hours from license_end
3. **Re-acquisition During Grace**: Should be blocked with available_at timestamp
4. **Re-acquisition After Grace**: Should succeed
5. **Grace to Expired Transition**: Verify configs are deleted and excluded_at is set
6. **Countdown Display**: Verify accurate time remaining display
7. **Cron Job**: Verify batch processing correctly transitions licenses

## Security Considerations

- Grace period enforcement happens server-side in edge functions
- Frontend displays are informational only
- Re-acquisition checks use database-level queries
- No client-side bypasses possible

## Monitoring

### Audit Logs
- `return_fanmark`: Includes `grace_expires_at` in metadata
- `license_grace_started`: Natural expiration to grace
- `license_expired`: Grace to expired transition

### Key Metrics
- Average grace period duration
- Number of re-acquisition attempts during grace
- Grace to expired transition success rate
