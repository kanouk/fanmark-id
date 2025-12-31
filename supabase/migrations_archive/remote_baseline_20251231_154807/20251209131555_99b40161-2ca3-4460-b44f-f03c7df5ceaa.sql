-- Add requester_username column to fanmark_transfer_requests
ALTER TABLE fanmark_transfer_requests ADD COLUMN IF NOT EXISTS requester_username text;