-- Native outbox marker for pending events. No external service is called from SQL.
-- The marker survives a failed Worker-to-Durable-Object wake and can be replayed.
CREATE TABLE notification_worker_wake_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  requested_generation INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(requested_generation) = 'integer' AND requested_generation BETWEEN 0 AND 9007199254740991),
  acknowledged_generation INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(acknowledged_generation) = 'integer' AND acknowledged_generation BETWEEN 0 AND requested_generation)
);
INSERT INTO notification_worker_wake_state (singleton_id) VALUES (1);

CREATE TRIGGER notification_event_request_wake_insert
AFTER INSERT ON notification_events WHEN NEW.status = 'pending'
BEGIN
  UPDATE notification_worker_wake_state SET requested_generation = requested_generation + 1 WHERE singleton_id = 1;
  SELECT RAISE(ABORT, 'notification_wake_update_suppressed') WHERE changes() <> 1;
  SELECT RAISE(ABORT, 'notification_wake_state_missing')
    WHERE NOT EXISTS (SELECT 1 FROM notification_worker_wake_state WHERE singleton_id = 1);
END;

CREATE TRIGGER notification_event_request_wake_update
AFTER UPDATE OF status, trigger_at ON notification_events
WHEN NEW.status = 'pending'
BEGIN
  UPDATE notification_worker_wake_state SET requested_generation = requested_generation + 1 WHERE singleton_id = 1;
  SELECT RAISE(ABORT, 'notification_wake_update_suppressed') WHERE changes() <> 1;
  SELECT RAISE(ABORT, 'notification_wake_state_missing')
    WHERE NOT EXISTS (SELECT 1 FROM notification_worker_wake_state WHERE singleton_id = 1);
END;

CREATE TRIGGER notification_worker_wake_state_monotonic
BEFORE UPDATE ON notification_worker_wake_state
WHEN NEW.requested_generation < OLD.requested_generation
  OR NEW.acknowledged_generation < OLD.acknowledged_generation
BEGIN
  SELECT RAISE(ABORT, 'notification_wake_generation_rewind');
END;
