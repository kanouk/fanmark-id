-- Durable cross-D1 signup reservations. Rows contain only an HMAC email
-- fingerprint; credentials and raw email stay in the Auth request/DB.
CREATE TABLE invitation_signup_attempts (
  attempt_id TEXT NOT NULL PRIMARY KEY,
  email_fingerprint TEXT NOT NULL,
  invitation_code_id TEXT,
  preferred_language TEXT NOT NULL CHECK (preferred_language IN ('en', 'ja', 'ko', 'id')),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'auth_created', 'completed', 'released')),
  auth_user_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verification_sent_at TEXT,
  processing_token TEXT,
  processing_lease_until TEXT,
  CHECK (
    (state IN ('reserved', 'released') AND auth_user_id IS NULL) OR
    (state IN ('auth_created', 'completed') AND auth_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX invitation_signup_attempts_open_email
  ON invitation_signup_attempts(email_fingerprint)
  WHERE state IN ('reserved', 'auth_created');

CREATE INDEX invitation_signup_attempts_code_reservations
  ON invitation_signup_attempts(invitation_code_id, state, expires_at);

CREATE TRIGGER invitation_signup_open_code_delete_guard
BEFORE DELETE ON invitation_codes
WHEN EXISTS (
  SELECT 1
  FROM invitation_signup_attempts a
  WHERE a.invitation_code_id = OLD.id
    AND a.state IN ('reserved', 'auth_created')
)
BEGIN
  SELECT RAISE(ABORT, 'invitation_code_has_signup_reservation');
END;

CREATE TRIGGER invitation_signup_capacity_guard
BEFORE UPDATE OF max_uses ON invitation_codes
WHEN NEW.max_uses < OLD.used_count + (
  SELECT COUNT(*)
  FROM invitation_signup_attempts a
  WHERE a.invitation_code_id = OLD.id
    AND (
      a.state = 'auth_created' OR
      (a.state = 'reserved' AND julianday(a.expires_at) > julianday('now'))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invitation_capacity_reserved');
END;

CREATE TRIGGER invitation_signup_profile_required
BEFORE UPDATE OF state ON invitation_signup_attempts
WHEN OLD.state = 'auth_created' AND NEW.state = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'signup_profile_required')
  WHERE NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = NEW.auth_user_id);
END;

CREATE TRIGGER invitation_signup_consume_code
AFTER UPDATE OF state ON invitation_signup_attempts
WHEN OLD.state = 'auth_created'
  AND NEW.state = 'completed'
  AND NEW.invitation_code_id IS NOT NULL
BEGIN
  UPDATE invitation_codes
  SET used_count = used_count + 1, updated_at = NEW.updated_at
  WHERE id = NEW.invitation_code_id;
END;
