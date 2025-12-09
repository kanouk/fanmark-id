-- Add requester_display_name column to fanmark_transfer_requests
ALTER TABLE fanmark_transfer_requests 
ADD COLUMN IF NOT EXISTS requester_display_name text;