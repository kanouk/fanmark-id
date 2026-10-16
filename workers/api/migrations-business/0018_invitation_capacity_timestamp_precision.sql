-- STAGING ONLY: compare durable invitation timestamps at their stored precision.
-- The prior julianday() check rounds fixed-width UTC microseconds before applying
-- an administrative max_uses reduction.
DROP TRIGGER invitation_signup_capacity_guard;

CREATE TRIGGER invitation_signup_capacity_guard
BEFORE UPDATE OF max_uses ON invitation_codes
WHEN NEW.max_uses < OLD.used_count + (
  SELECT COUNT(*)
  FROM invitation_signup_attempts a
  WHERE a.invitation_code_id = OLD.id
    AND (
      a.state = 'auth_created' OR
      (a.state = 'reserved' AND a.expires_at > strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invitation_capacity_reserved');
END;
