-- Enable pg_net extension for HTTP requests in cron jobs
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant necessary permissions for the cron job to use pg_net
GRANT EXECUTE ON FUNCTION net.http_post TO postgres;

-- Verify the extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_net';