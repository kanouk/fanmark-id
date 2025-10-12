-- ====================================
-- Fix 1: Separate user roles from plan types
-- ====================================

-- Create enum for application roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- RLS policy: Admins can manage roles
CREATE POLICY "Admins can manage all user roles"
ON public.user_roles
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
  )
);

-- RLS policy: Users can view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Migrate existing admin users from plan_type to roles
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin'::app_role
FROM public.user_settings
WHERE plan_type = 'admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- Update is_admin() function to use new role system
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN public.has_role(current_user_id, 'admin');
END;
$$;

-- Update is_super_admin() function to use new role system
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  has_recent_session BOOLEAN := FALSE;
  is_admin_user BOOLEAN := FALSE;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if user has admin role
  is_admin_user := public.has_role(current_user_id, 'admin');

  IF NOT is_admin_user THEN
    RETURN FALSE;
  END IF;

  -- Require a recent session within the last 4 hours
  SELECT EXISTS(
    SELECT 1
    FROM auth.sessions s
    WHERE s.user_id = current_user_id
      AND s.created_at > now() - INTERVAL '4 hours'
      AND COALESCE(s.aal, '') <> ''
  )
  INTO has_recent_session;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    current_user_id,
    'ADMIN_CHECK',
    'system',
    jsonb_build_object(
      'timestamp', now(),
      'session_valid', has_recent_session,
      'admin_check_result', has_recent_session
    )
  );

  RETURN has_recent_session;
END;
$$;

-- ====================================
-- Fix 2: Add public read access to emoji_master
-- ====================================

-- Allow authenticated users to view emoji catalog
CREATE POLICY "Authenticated users can view emoji catalog"
ON public.emoji_master
FOR SELECT
TO authenticated
USING (true);

-- Add audit logging for admin actions on emoji_master
CREATE OR REPLACE FUNCTION public.log_emoji_master_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_DELETE',
      'emoji_master',
      OLD.id::text,
      jsonb_build_object('emoji', OLD.emoji, 'short_name', OLD.short_name)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_UPDATE',
      'emoji_master',
      NEW.id::text,
      jsonb_build_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_INSERT',
      'emoji_master',
      NEW.id::text,
      jsonb_build_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_emoji_master_changes
AFTER INSERT OR UPDATE OR DELETE ON public.emoji_master
FOR EACH ROW
EXECUTE FUNCTION public.log_emoji_master_changes();