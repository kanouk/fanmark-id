-- Add 'ko' and 'id' to user_language enum for internationalization support
-- Note: PostgreSQL enum values cannot be removed once added, only new values can be added

-- Add Korean language support
ALTER TYPE user_language ADD VALUE IF NOT EXISTS 'ko';

-- Add Indonesian language support  
ALTER TYPE user_language ADD VALUE IF NOT EXISTS 'id';