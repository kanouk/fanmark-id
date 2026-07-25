-- Keep the existing one-minute notification delivery SLA while avoiding empty
-- pg_cron/pg_net runs. The job sleeps when the queue is empty and is woken by
-- notification_events inserts or reschedules.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.activate_notification_worker()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  notification_job_id bigint;
  notification_job_active boolean;
BEGIN
  -- Serialize wake/sleep decisions so a concurrent insert cannot be lost while
  -- the worker is deciding to deactivate itself.
  PERFORM pg_catalog.pg_advisory_xact_lock(724561839104227);

  SELECT jobid, active
    INTO notification_job_id, notification_job_active
  FROM cron.job
  WHERE jobname = 'process-notification-events-every-minute';

  IF notification_job_id IS NULL THEN
    RAISE WARNING 'Notification worker cron job was not found';
    RETURN false;
  END IF;

  IF NOT notification_job_active THEN
    PERFORM cron.alter_job(notification_job_id, active := true);
  END IF;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    -- Notification event creation must not break a user-facing operation when
    -- the scheduler is temporarily unavailable.
    RAISE WARNING 'Failed to activate notification worker: %', SQLERRM;
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_notification_worker_on_pending_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.activate_notification_worker();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_notification_worker_if_idle()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  notification_job_id bigint;
  notification_job_active boolean;
BEGIN
  -- This is the same lock used by activate_notification_worker(). Whichever
  -- transaction wins, the later transaction rechecks committed queue state.
  PERFORM pg_catalog.pg_advisory_xact_lock(724561839104227);

  -- Future trigger_at values remain pending, so the existing at-most-one-minute
  -- delivery behavior is preserved when delayed events are introduced.
  IF EXISTS (
    SELECT 1
    FROM public.notification_events
    WHERE status = 'pending'
  ) THEN
    RETURN false;
  END IF;

  SELECT jobid, active
    INTO notification_job_id, notification_job_active
  FROM cron.job
  WHERE jobname = 'process-notification-events-every-minute';

  IF notification_job_id IS NULL THEN
    RAISE WARNING 'Notification worker cron job was not found';
    RETURN false;
  END IF;

  IF notification_job_active THEN
    PERFORM cron.alter_job(notification_job_id, active := false);
  END IF;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    -- Fail open: leaving the job active retains the pre-change retry behavior.
    RAISE WARNING 'Failed to deactivate notification worker: %', SQLERRM;
    RETURN false;
END;
$$;

DROP TRIGGER IF EXISTS activate_notification_worker_on_pending_event
ON public.notification_events;

CREATE TRIGGER activate_notification_worker_on_pending_event
AFTER INSERT OR UPDATE OF status, trigger_at
ON public.notification_events
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.activate_notification_worker_on_pending_event();

REVOKE ALL ON FUNCTION public.activate_notification_worker()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.activate_notification_worker_on_pending_event()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_notification_worker_if_idle()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_notification_worker_if_idle()
TO service_role;

COMMENT ON FUNCTION public.activate_notification_worker() IS
'Activates the one-minute notification cron job after pending work is queued.';
COMMENT ON FUNCTION public.activate_notification_worker_on_pending_event() IS
'Trigger function that wakes the notification cron job without failing event creation.';
COMMENT ON FUNCTION public.deactivate_notification_worker_if_idle() IS
'Deactivates the notification cron job only when no pending events remain.';

-- Initialize the job from current queue state. A non-empty queue stays active;
-- an empty queue stops immediately after this migration is applied.
SELECT public.deactivate_notification_worker_if_idle();
