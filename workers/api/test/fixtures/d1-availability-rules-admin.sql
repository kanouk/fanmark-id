CREATE TABLE IF NOT EXISTS fanmark_availability_rules (
  id TEXT PRIMARY KEY NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('specific_pattern', 'duplicate_pattern', 'prefix_pattern', 'count_based')),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),
  rule_config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rule_config)),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  price_usd INTEGER,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
