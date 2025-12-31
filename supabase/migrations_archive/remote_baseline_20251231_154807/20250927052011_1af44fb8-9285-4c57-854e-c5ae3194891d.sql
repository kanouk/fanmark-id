-- Add plan exclusion columns to fanmark_licenses table for plan downgrade functionality
ALTER TABLE fanmark_licenses
ADD COLUMN plan_excluded boolean DEFAULT false,
ADD COLUMN excluded_at timestamp with time zone,
ADD COLUMN excluded_from_plan text;