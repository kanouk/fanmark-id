-- Make fanmark_licenses.user_id nullable to allow historical data retention after user deletion
-- This resolves the design contradiction between NOT NULL constraint and ON DELETE SET NULL foreign key

ALTER TABLE fanmark_licenses 
ALTER COLUMN user_id DROP NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN fanmark_licenses.user_id IS 
'User who owns/owned this license. NULL indicates the user account has been deleted but license history is retained for audit purposes.';