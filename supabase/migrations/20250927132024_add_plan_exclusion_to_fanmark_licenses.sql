-- Add plan exclusion fields to fanmark_licenses table
-- This migration adds fields to support plan downgrade functionality
-- where users can exclude fanmarks from their plan while keeping them until expiration

-- Add new columns to fanmark_licenses table
ALTER TABLE fanmark_licenses
ADD COLUMN plan_excluded boolean DEFAULT false,
ADD COLUMN excluded_at timestamp with time zone,
ADD COLUMN excluded_from_plan text;

-- Add index for efficient querying of plan excluded licenses
CREATE INDEX idx_fanmark_licenses_plan_excluded
ON fanmark_licenses (plan_excluded, excluded_at)
WHERE plan_excluded = true;

-- Add index for efficient expiration checks on plan excluded licenses
CREATE INDEX idx_fanmark_licenses_plan_excluded_status_end
ON fanmark_licenses (plan_excluded, status, license_end)
WHERE plan_excluded = true;

-- Add comment to document the purpose
COMMENT ON COLUMN fanmark_licenses.plan_excluded IS 'Indicates if this license is excluded from the user plan (due to downgrade)';
COMMENT ON COLUMN fanmark_licenses.excluded_at IS 'Timestamp when the license was excluded from the plan';
COMMENT ON COLUMN fanmark_licenses.excluded_from_plan IS 'The plan type the user downgraded from (for audit purposes)';