-- Fix notification_events.source constraint
ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_source_check;
ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_source_check 
  CHECK (source IN ('system', 'cron_job', 'edge_function', 'admin_ui', 'admin_manual', 'batch'));

-- Fix notification_events.status constraint
ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_status_check;
ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_status_check 
  CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'skipped'));

-- Update any existing 'error' status to 'failed'
UPDATE public.notification_events SET status = 'failed' WHERE status = 'error';

-- Fix notifications.status constraint to include 'delivered'
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check 
  CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled', 'sending', 'sent'));

-- Add RLS policy for admins to view all notifications
CREATE POLICY "Admins can view all notifications" 
  ON public.notifications 
  FOR SELECT 
  USING (public.is_admin());

-- Unschedule the hardcoded cron job
SELECT cron.unschedule('process-notification-events-every-minute') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-notification-events-every-minute'
);