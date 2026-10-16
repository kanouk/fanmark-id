-- Preserve complaint/permanent-bounce outcomes independently of arrival order.
-- Only structure changes: no audience copy, historical row rewrite, or email send.
CREATE VIEW broadcast_delivery_effective_events AS
SELECT event.id, event.provider_email_id, event.created_at,
  CASE event.event_type
    WHEN 'email.delivered' THEN 'delivered'
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'suppressed'
    ELSE 'failed'
  END AS status,
  CASE event.event_type
    WHEN 'email.bounced' THEN 'provider_bounced'
    WHEN 'email.complained' THEN 'provider_complaint'
    WHEN 'email.failed' THEN 'provider_failed'
    WHEN 'email.suppressed' THEN 'provider_suppressed'
    ELSE NULL
  END AS error_code,
  CASE
    WHEN event.event_type = 'email.complained' THEN 'complaint'
    WHEN event.event_type = 'email.bounced' AND event.bounce_type = 'Permanent' THEN 'permanent_bounce'
    ELSE NULL
  END AS suppression_reason
FROM broadcast_delivery_webhook_events AS event
WHERE event.id = (
  SELECT candidate.id FROM broadcast_delivery_webhook_events AS candidate
  WHERE candidate.provider_email_id = event.provider_email_id
    AND candidate.event_type IN ('email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed')
  ORDER BY CASE
    WHEN candidate.event_type = 'email.complained' THEN 2
    WHEN candidate.event_type = 'email.bounced' AND candidate.bounce_type = 'Permanent' THEN 1
    ELSE 0 END DESC,
    candidate.created_at DESC, candidate.id DESC LIMIT 1
);

DROP TRIGGER broadcast_delivery_webhook_apply;
DROP TRIGGER broadcast_delivery_replay_webhook_on_message_link;

CREATE TRIGGER broadcast_delivery_webhook_apply
AFTER INSERT ON broadcast_delivery_webhook_events
BEGIN
  UPDATE broadcast_delivery_recipients
  SET status = (SELECT status FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id),
      last_error_code = (SELECT error_code FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id),
      updated_at = (SELECT created_at FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id),
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE provider_email_id = NEW.provider_email_id
    AND EXISTS (SELECT 1 FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id);

  INSERT INTO broadcast_delivery_suppressions (user_id, reason, source_event_id, created_at)
  SELECT recipient.user_id, effective.suppression_reason, effective.id, effective.created_at
  FROM broadcast_delivery_effective_events AS effective
  JOIN broadcast_delivery_recipients AS recipient ON recipient.provider_email_id = effective.provider_email_id
  WHERE effective.provider_email_id = NEW.provider_email_id AND effective.suppression_reason IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET
    reason = excluded.reason,
    source_event_id = excluded.source_event_id,
    created_at = excluded.created_at
  WHERE excluded.reason = 'complaint' OR broadcast_delivery_suppressions.reason <> 'complaint';

  UPDATE broadcast_delivery_recipients
  SET status = 'suppressed', lease_token = NULL, lease_expires_at = NULL,
      last_error_code = 'recipient_suppressed', updated_at = NEW.created_at
  WHERE user_id IN (SELECT user_id FROM broadcast_delivery_recipients WHERE provider_email_id = NEW.provider_email_id)
    AND status IN ('pending', 'sending') AND provider_email_id IS NULL
    AND EXISTS (SELECT 1 FROM broadcast_delivery_suppressions AS suppression
      WHERE suppression.user_id = broadcast_delivery_recipients.user_id);
END;

CREATE TRIGGER broadcast_delivery_replay_webhook_on_message_link
AFTER UPDATE OF provider_email_id ON broadcast_delivery_recipients
WHEN NEW.provider_email_id IS NOT NULL AND NEW.provider_email_id IS NOT OLD.provider_email_id
BEGIN
  UPDATE broadcast_delivery_recipients
  SET status = (SELECT status FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id),
      last_error_code = (SELECT error_code FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id),
      updated_at = (SELECT created_at FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id),
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE run_id = NEW.run_id AND user_id = NEW.user_id
    AND EXISTS (SELECT 1 FROM broadcast_delivery_effective_events WHERE provider_email_id = NEW.provider_email_id);

  INSERT INTO broadcast_delivery_suppressions (user_id, reason, source_event_id, created_at)
  SELECT NEW.user_id, effective.suppression_reason, effective.id, effective.created_at
  FROM broadcast_delivery_effective_events AS effective
  WHERE effective.provider_email_id = NEW.provider_email_id AND effective.suppression_reason IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET
    reason = excluded.reason,
    source_event_id = excluded.source_event_id,
    created_at = excluded.created_at
  WHERE excluded.reason = 'complaint' OR broadcast_delivery_suppressions.reason <> 'complaint';

  UPDATE broadcast_delivery_recipients
  SET status = 'suppressed', lease_token = NULL, lease_expires_at = NULL,
      last_error_code = 'recipient_suppressed', updated_at = NEW.updated_at
  WHERE user_id = NEW.user_id
    AND status IN ('pending', 'sending') AND provider_email_id IS NULL
    AND EXISTS (SELECT 1 FROM broadcast_delivery_suppressions AS suppression
      WHERE suppression.user_id = broadcast_delivery_recipients.user_id);
END;

