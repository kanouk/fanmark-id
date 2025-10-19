-- Phase 1: Notification System Database Schema
-- Create core notification tables with RLS policies

-- ================================================================
-- 1. notification_events table
-- ================================================================
CREATE TABLE public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK (source IN ('batch', 'edge_function', 'admin_ui')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_schema TEXT,
  trigger_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'error', 'skipped')),
  processed_at TIMESTAMPTZ,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_event_dedupe UNIQUE(event_type, dedupe_key)
);

-- Indexes for notification_events
CREATE INDEX idx_notification_events_status_trigger 
ON public.notification_events(status, trigger_at)
WHERE status = 'pending';

CREATE INDEX idx_notification_events_event_type 
ON public.notification_events(event_type);

-- RLS for notification_events
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view notification events"
ON public.notification_events FOR SELECT
USING (public.is_admin());

CREATE POLICY "System can manage notification events"
ON public.notification_events FOR ALL
USING (auth.role() = 'service_role');

-- ================================================================
-- 2. notification_templates table
-- ================================================================
CREATE TABLE public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  language TEXT NOT NULL DEFAULT 'ja',
  title TEXT,
  body TEXT NOT NULL,
  summary TEXT,
  payload_schema JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_template_version UNIQUE(template_id, version, channel, language)
);

-- RLS for notification_templates
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage templates"
ON public.notification_templates FOR ALL
USING (public.is_admin());

CREATE POLICY "Authenticated users can view active templates"
ON public.notification_templates FOR SELECT
USING (is_active = true AND auth.uid() IS NOT NULL);

-- ================================================================
-- 3. notification_rules table
-- ================================================================
CREATE TABLE public.notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  template_id UUID NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  segment_filter JSONB,
  cooldown_window_seconds INTEGER,
  max_per_user INTEGER,
  cancel_condition TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index for notification_rules
CREATE INDEX idx_notification_rules_event_type 
ON public.notification_rules(event_type)
WHERE enabled = true;

-- RLS for notification_rules
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage notification rules"
ON public.notification_rules FOR ALL
USING (public.is_admin());

-- ================================================================
-- 4. notifications table
-- ================================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.notification_events(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  template_id UUID NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  read_at TIMESTAMPTZ,
  read_via TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for notifications
CREATE INDEX idx_notifications_user_unread 
ON public.notifications(user_id, read_at)
WHERE read_at IS NULL AND channel = 'in_app';

CREATE INDEX idx_notifications_status_channel 
ON public.notifications(status, channel)
WHERE status IN ('pending', 'failed');

CREATE INDEX idx_notifications_user_created 
ON public.notifications(user_id, created_at DESC);

-- RLS for notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "System can manage all notifications"
ON public.notifications FOR ALL
USING (auth.role() = 'service_role');

-- ================================================================
-- 5. notification_preferences table (future expansion)
-- ================================================================
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  event_type TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_user_channel_event UNIQUE(user_id, channel, event_type)
);

-- RLS for notification_preferences
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own preferences"
ON public.notification_preferences FOR ALL
USING (auth.uid() = user_id);

-- ================================================================
-- 6. notifications_history table (archive)
-- ================================================================
CREATE TABLE public.notifications_history (
  id UUID PRIMARY KEY,
  original_data JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for notifications_history
ALTER TABLE public.notifications_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view notification history"
ON public.notifications_history FOR SELECT
USING (public.is_admin());

-- ================================================================
-- 7. Triggers for updated_at
-- ================================================================
CREATE TRIGGER update_notification_events_updated_at
BEFORE UPDATE ON public.notification_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notification_templates_updated_at
BEFORE UPDATE ON public.notification_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notification_rules_updated_at
BEFORE UPDATE ON public.notification_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notifications_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ================================================================
-- 8. Comments for documentation
-- ================================================================
COMMENT ON TABLE public.notification_events IS 'Stores notification trigger events with deduplication';
COMMENT ON TABLE public.notification_rules IS 'Defines notification delivery rules per event type';
COMMENT ON TABLE public.notifications IS 'Actual notification records delivered to users';
COMMENT ON TABLE public.notification_templates IS 'Notification message templates with versioning';
COMMENT ON TABLE public.notification_preferences IS 'User notification preferences (future expansion)';
COMMENT ON TABLE public.notifications_history IS 'Archived notifications for compliance';
