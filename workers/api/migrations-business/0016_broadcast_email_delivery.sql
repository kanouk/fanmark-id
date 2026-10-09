-- Durable, recipient-address-free broadcast delivery state. This migration
-- creates structure only; it does not copy Auth users or send email.

CREATE TABLE broadcast_delivery_runs (
  id TEXT NOT NULL,
  broadcast_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  recipient_filter TEXT,
  last_auth_user_id TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  template_snapshot TEXT,
  snapshot_lease_token TEXT,
  snapshot_lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  CONSTRAINT broadcast_delivery_runs_pkey PRIMARY KEY (id),
  CONSTRAINT broadcast_delivery_runs_broadcast_key UNIQUE (broadcast_id),
  CONSTRAINT broadcast_delivery_runs_request_key UNIQUE (requested_by, request_id),
  CONSTRAINT broadcast_delivery_runs_broadcast_fkey FOREIGN KEY (broadcast_id)
    REFERENCES broadcast_emails(id) ON DELETE CASCADE,
  CONSTRAINT broadcast_delivery_runs_status_check
    CHECK (status IN ('snapshotting', 'sending', 'completed', 'failed', 'needs_review', 'cancelled')),
  CONSTRAINT broadcast_delivery_runs_filter_check
    CHECK (recipient_filter IS NULL OR json_valid(recipient_filter)),
  CONSTRAINT broadcast_delivery_runs_template_check
    CHECK (template_snapshot IS NULL OR json_valid(template_snapshot)),
  CONSTRAINT broadcast_delivery_runs_count_check
    CHECK (typeof(recipient_count) = 'integer' AND recipient_count >= 0)
);

CREATE TABLE broadcast_delivery_recipients (
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  first_attempt_at TEXT,
  idempotency_expires_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  provider_email_id TEXT,
  payload_fingerprint TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT broadcast_delivery_recipients_pkey PRIMARY KEY (run_id, user_id),
  CONSTRAINT broadcast_delivery_recipients_run_fkey FOREIGN KEY (run_id)
    REFERENCES broadcast_delivery_runs(id) ON DELETE CASCADE,
  CONSTRAINT broadcast_delivery_recipients_language_check
    CHECK (language IN ('en', 'ja', 'ko', 'id')),
  CONSTRAINT broadcast_delivery_recipients_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'suppressed', 'needs_review')),
  CONSTRAINT broadcast_delivery_recipients_attempts_check
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
  CONSTRAINT broadcast_delivery_recipients_error_code_check
    CHECK (last_error_code IS NULL OR (length(last_error_code) <= 80 AND last_error_code NOT GLOB '*[^A-Za-z0-9_-]*')),
  CONSTRAINT broadcast_delivery_recipients_payload_fingerprint_check
    CHECK (payload_fingerprint IS NULL OR
      (length(payload_fingerprint) = 64 AND payload_fingerprint NOT GLOB '*[^a-f0-9]*'))
);

CREATE INDEX broadcast_delivery_recipients_ready_idx
  ON broadcast_delivery_recipients (status, next_attempt_at, run_id, user_id);
CREATE INDEX broadcast_delivery_recipients_lease_idx
  ON broadcast_delivery_recipients (status, lease_expires_at);
CREATE UNIQUE INDEX broadcast_delivery_recipients_provider_email_key
  ON broadcast_delivery_recipients (provider_email_id)
  WHERE provider_email_id IS NOT NULL;

CREATE TABLE broadcast_delivery_suppressions (
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT broadcast_delivery_suppressions_pkey PRIMARY KEY (user_id),
  CONSTRAINT broadcast_delivery_suppressions_reason_check
    CHECK (reason IN ('permanent_bounce', 'complaint'))
);

CREATE TABLE broadcast_delivery_webhook_events (
  id TEXT NOT NULL,
  provider_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  bounce_type TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT broadcast_delivery_webhook_events_pkey PRIMARY KEY (id),
  CONSTRAINT broadcast_delivery_webhook_events_type_check
    CHECK (event_type IN ('email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed')),
  CONSTRAINT broadcast_delivery_webhook_events_bounce_check
    CHECK (bounce_type IS NULL OR bounce_type IN ('Permanent', 'Transient', 'Undetermined'))
);

CREATE INDEX broadcast_delivery_webhook_events_email_idx
  ON broadcast_delivery_webhook_events (provider_email_id, created_at);

CREATE TRIGGER broadcast_delivery_webhook_apply
AFTER INSERT ON broadcast_delivery_webhook_events
BEGIN
  UPDATE broadcast_delivery_recipients
  SET status = CASE
        WHEN NEW.event_type = 'email.delivered' THEN 'delivered'
        WHEN NEW.event_type = 'email.bounced' THEN 'bounced'
        WHEN NEW.event_type = 'email.complained' THEN 'suppressed'
        WHEN NEW.event_type = 'email.failed' OR NEW.event_type = 'email.suppressed' THEN 'failed'
        ELSE status
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = CASE
        WHEN NEW.event_type = 'email.bounced' THEN 'provider_bounced'
        WHEN NEW.event_type = 'email.complained' THEN 'provider_complaint'
        WHEN NEW.event_type = 'email.failed' THEN 'provider_failed'
        WHEN NEW.event_type = 'email.suppressed' THEN 'provider_suppressed'
        ELSE last_error_code
      END,
      updated_at = NEW.created_at
  WHERE provider_email_id = NEW.provider_email_id
    AND NEW.event_type IN ('email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed');

  INSERT INTO broadcast_delivery_suppressions (user_id, reason, source_event_id, created_at)
  SELECT user_id,
    CASE WHEN NEW.event_type = 'email.complained' THEN 'complaint' ELSE 'permanent_bounce' END,
    NEW.id,
    NEW.created_at
  FROM broadcast_delivery_recipients
  WHERE provider_email_id = NEW.provider_email_id
    AND (
      NEW.event_type = 'email.complained'
      OR (NEW.event_type = 'email.bounced' AND NEW.bounce_type = 'Permanent')
    )
  ON CONFLICT (user_id) DO UPDATE SET
    reason = excluded.reason,
    source_event_id = excluded.source_event_id,
    created_at = excluded.created_at;

  UPDATE broadcast_delivery_recipients
  SET status = 'suppressed',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = 'recipient_suppressed',
      updated_at = NEW.created_at
  WHERE user_id IN (SELECT user_id FROM broadcast_delivery_recipients WHERE provider_email_id = NEW.provider_email_id)
    AND status IN ('pending', 'sending')
    AND provider_email_id IS NULL;
END;

-- A provider event can arrive before the sender persists the provider message
-- ID (for example, after Resend accepted a request but the Worker lost its
-- response). Replay already stored events when that ID is eventually attached.
CREATE TRIGGER broadcast_delivery_replay_webhook_on_message_link
AFTER UPDATE OF provider_email_id ON broadcast_delivery_recipients
WHEN NEW.provider_email_id IS NOT NULL AND NEW.provider_email_id IS NOT OLD.provider_email_id
BEGIN
  UPDATE broadcast_delivery_recipients
  SET status = COALESCE((
        SELECT CASE event.event_type
          WHEN 'email.delivered' THEN 'delivered'
          WHEN 'email.bounced' THEN 'bounced'
          WHEN 'email.complained' THEN 'suppressed'
          WHEN event.event_type IN ('email.failed', 'email.suppressed') THEN 'failed'
          ELSE NULL
        END
        FROM broadcast_delivery_webhook_events AS event
        WHERE event.provider_email_id = NEW.provider_email_id
          AND event.event_type IN ('email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed')
        ORDER BY event.created_at DESC, event.id DESC LIMIT 1
      ), status),
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = COALESCE((
        SELECT event.created_at FROM broadcast_delivery_webhook_events AS event
        WHERE event.provider_email_id = NEW.provider_email_id
          AND event.event_type IN ('email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed')
        ORDER BY event.created_at DESC, event.id DESC LIMIT 1
      ), updated_at)
  WHERE run_id = NEW.run_id AND user_id = NEW.user_id;

  INSERT INTO broadcast_delivery_suppressions (user_id, reason, source_event_id, created_at)
  SELECT NEW.user_id,
    CASE WHEN event.event_type = 'email.complained' THEN 'complaint' ELSE 'permanent_bounce' END,
    event.id,
    event.created_at
  FROM broadcast_delivery_webhook_events AS event
  WHERE event.provider_email_id = NEW.provider_email_id
    AND (event.event_type = 'email.complained' OR
      (event.event_type = 'email.bounced' AND event.bounce_type = 'Permanent'))
  ORDER BY event.created_at DESC, event.id DESC LIMIT 1
  ON CONFLICT (user_id) DO UPDATE SET
    reason = excluded.reason,
    source_event_id = excluded.source_event_id,
    created_at = excluded.created_at;

  UPDATE broadcast_delivery_recipients
  SET status = 'suppressed',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = 'recipient_suppressed',
      updated_at = NEW.updated_at
  WHERE user_id = NEW.user_id
    AND status IN ('pending', 'sending')
    AND provider_email_id IS NULL;
END;
