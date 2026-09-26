CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
    substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
    hex(randomblob(6))
  )),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
