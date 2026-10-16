-- Read-only aggregate operational observations; no identity, payload or credential columns.
-- Run only through staging-operations-status.mjs, which verifies the account/bindings first.
SELECT
  (SELECT count(*) FROM pragma_foreign_key_check) AS foreign_key_violations,
  (SELECT count(*) FROM notification_worker_wake_state WHERE singleton_id = 1) AS wake_singletons,
  (SELECT requested_generation FROM notification_worker_wake_state WHERE singleton_id = 1) AS wake_requested,
  (SELECT acknowledged_generation FROM notification_worker_wake_state WHERE singleton_id = 1) AS wake_acknowledged,
  (SELECT count(*) FROM notification_events WHERE status = 'pending') AS notification_pending,
  (SELECT count(*) FROM notification_events WHERE status = 'pending'
     AND julianday(trigger_at) < julianday('now', '-2 minutes')) AS notification_overdue,
  (SELECT count(*) FROM notification_events WHERE status = 'processing'
     AND julianday(updated_at) < julianday('now', '-10 minutes')) AS notification_stale_processing,
  (SELECT count(*) FROM notification_events WHERE status = 'failed') AS notification_failed,
  (SELECT count(*) FROM notifications WHERE status IN ('delivered', 'failed')
     AND julianday(created_at) < julianday('now', '-90 days')) AS notification_archive_candidates,
  (SELECT count(*) FROM license_expiry_runs WHERE status = 'running') AS expiry_open_runs,
  (SELECT count(*) FROM license_grace_finalization_runs WHERE status = 'running') AS finalization_open_runs,
  (SELECT count(*) FROM fanmark_licenses WHERE status = 'active' AND license_end IS NOT NULL
     AND julianday(license_end) < julianday('now')) AS finite_licenses_past_end,
  (SELECT count(*) FROM fanmark_licenses WHERE status = 'grace'
     AND julianday(grace_expires_at) < julianday('now')) AS grace_licenses_past_end,
  (SELECT count(*) FROM stripe_webhook_dispatches WHERE status = 'dead_letter') AS stripe_dead_letters,
  (SELECT count(*) FROM stripe_webhook_dispatches WHERE status IN ('pending', 'retryable')
     AND julianday(available_at) < julianday('now', '-2 minutes')) AS stripe_overdue,
  (SELECT count(*) FROM stripe_webhook_dispatches WHERE status = 'processing'
     AND julianday(lease_until) < julianday('now')) AS stripe_expired_leases;
