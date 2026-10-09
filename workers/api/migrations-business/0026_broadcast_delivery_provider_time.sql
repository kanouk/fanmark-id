-- Keep provider occurrence time separate from the local receipt timestamp.
-- Existing receipts retain NULL: their occurrence time is unknown, not inferred.
ALTER TABLE broadcast_delivery_webhook_events ADD COLUMN provider_created_at TEXT
  CHECK (provider_created_at IS NULL OR
    (typeof(provider_created_at) = 'text' AND length(provider_created_at) >= 27
      AND substr(provider_created_at, 1, 20) GLOB '????-??-??T??:??:??.'
      AND replace(replace(replace(replace(substr(provider_created_at, 1, 20), '-', ''), ':', ''), 'T', ''), '.', '') NOT GLOB '*[^0-9]*'
      AND substr(provider_created_at, -1) = 'Z'
      AND substr(provider_created_at, 21, length(provider_created_at) - 21) NOT GLOB '*[^0-9]*'));

DROP VIEW broadcast_delivery_effective_events;

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
    rtrim(substr(COALESCE(candidate.provider_created_at, candidate.created_at), 1,
      length(COALESCE(candidate.provider_created_at, candidate.created_at)) - 1), '0') DESC, candidate.id DESC LIMIT 1
);

