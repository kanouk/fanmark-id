-- Global paid-search admission. No query text, IP, user ID or selection history.
-- Failed/aborted admissions count too; no automatic retry or refund of attempts.
CREATE TABLE emoji_palette_daily_budget (
  day TEXT PRIMARY KEY,
  searches INTEGER NOT NULL CHECK(searches BETWEEN 1 AND 100),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls >= 0)
);
