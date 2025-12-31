-- First, drop existing functions that we need to modify
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text);
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text);

-- Remove the permissive RLS policy that allows direct access to password configs
DROP POLICY IF EXISTS "Users can manage password configs for their licensed fanmarks" ON public.fanmark_password_configs;

-- Create a restrictive RLS policy that denies all direct access
CREATE POLICY "Deny direct access to password configs" 
ON public.fanmark_password_configs 
FOR ALL 
USING (false) 
WITH CHECK (false);

-- Create a secure function to verify passwords without exposing them
CREATE OR REPLACE FUNCTION public.verify_fanmark_password(
  fanmark_uuid uuid,
  provided_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored_password text;
  is_enabled boolean;
BEGIN
  -- Get the password configuration for the fanmark
  SELECT 
    pc.access_password,
    pc.is_enabled
  INTO stored_password, is_enabled
  FROM public.fanmark_password_configs pc
  WHERE pc.fanmark_id = fanmark_uuid;
  
  -- Return false if no password config found or not enabled
  IF stored_password IS NULL OR is_enabled IS FALSE THEN
    RETURN false;
  END IF;
  
  -- Return true if passwords match
  RETURN stored_password = provided_password;
END;
$$;

-- Create a secure function for fanmark owners to manage password configs
CREATE OR REPLACE FUNCTION public.upsert_fanmark_password_config(
  fanmark_uuid uuid,
  new_password text,
  enable_password boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  config_id uuid;
BEGIN
  -- Verify the user owns an active license for this fanmark
  IF NOT EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid 
      AND fl.user_id = auth.uid() 
      AND fl.status = 'active' 
      AND fl.license_end > now()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: User does not have active license for this fanmark';
  END IF;

  -- Upsert the password configuration
  INSERT INTO public.fanmark_password_configs (
    fanmark_id,
    access_password,
    is_enabled
  ) VALUES (
    fanmark_uuid,
    new_password,
    enable_password
  )
  ON CONFLICT (fanmark_id) DO UPDATE SET
    access_password = EXCLUDED.access_password,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now()
  RETURNING id INTO config_id;
  
  RETURN config_id;
END;
$$;

-- Create a function to check if a fanmark has password protection enabled
CREATE OR REPLACE FUNCTION public.is_fanmark_password_protected(fanmark_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.fanmark_password_configs WHERE fanmark_id = fanmark_uuid),
    false
  );
$$;

-- Recreate the get_fanmark_by_emoji function without password exposure
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
  id uuid, 
  emoji_combination text, 
  fanmark_name text, 
  access_type text, 
  target_url text, 
  text_content text, 
  status text, 
  is_password_protected boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, 'inactive') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = 'active';
END;
$$;

-- Recreate the get_fanmark_complete_data function without password exposure
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
RETURNS TABLE(
  id uuid, 
  emoji_combination text, 
  normalized_emoji text, 
  short_id text, 
  access_type text, 
  status text, 
  created_at timestamp with time zone, 
  updated_at timestamp with time zone, 
  fanmark_name text, 
  target_url text, 
  text_content text, 
  is_password_protected boolean, 
  current_owner_id uuid, 
  license_end timestamp with time zone, 
  has_active_license boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, 'inactive') as access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection status only (no actual password)
        COALESCE(pc.is_enabled, false) as is_password_protected,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = 'active' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$$;