CREATE TABLE invitation_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TEXT,
  special_perks TEXT CHECK (special_perks IS NULL OR json_valid(special_perks)),
  created_by TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  invited_by_code TEXT REFERENCES invitation_codes(code)
);
