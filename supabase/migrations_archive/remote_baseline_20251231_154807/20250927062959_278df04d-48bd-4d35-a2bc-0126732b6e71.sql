-- Drop existing tables and functions, then recreate with license_id structure
-- This will delete all existing data as requested

-- Drop existing functions first to avoid conflicts
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text) CASCADE;
DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text) CASCADE;
DROP FUNCTION IF EXISTS public.upsert_fanmark_password_config(uuid, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid) CASCADE;

-- Drop existing configuration tables
DROP TABLE IF EXISTS public.fanmark_basic_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_redirect_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_messageboard_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_password_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_profiles CASCADE;

-- Recreate fanmark_basic_configs with license_id
CREATE TABLE public.fanmark_basic_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    fanmark_name text,
    access_type text NOT NULL DEFAULT 'inactive'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
);

-- Recreate fanmark_redirect_configs with license_id
CREATE TABLE public.fanmark_redirect_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    target_url text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
);

-- Recreate fanmark_messageboard_configs with license_id
CREATE TABLE public.fanmark_messageboard_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    content text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
);

-- Recreate fanmark_password_configs with license_id
CREATE TABLE public.fanmark_password_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    access_password text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
);

-- Recreate fanmark_profiles with license_id only
CREATE TABLE public.fanmark_profiles (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    display_name text,
    bio text,
    social_links jsonb DEFAULT '{}'::jsonb,
    theme_settings jsonb DEFAULT '{}'::jsonb,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
);

-- Enable RLS on all tables
ALTER TABLE public.fanmark_basic_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_redirect_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_messageboard_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_password_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage configs for their own licenses" ON public.fanmark_basic_configs
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_basic_configs.license_id
        AND fl.user_id = auth.uid()
        AND fl.status = 'active'
        AND fl.license_end > now()
    )
);

CREATE POLICY "Users can manage redirect configs for their own licenses" ON public.fanmark_redirect_configs
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_redirect_configs.license_id
        AND fl.user_id = auth.uid()
        AND fl.status = 'active'
        AND fl.license_end > now()
    )
);

CREATE POLICY "Users can manage messageboard configs for their own licenses" ON public.fanmark_messageboard_configs
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_messageboard_configs.license_id
        AND fl.user_id = auth.uid()
        AND fl.status = 'active'
        AND fl.license_end > now()
    )
);

CREATE POLICY "Deny direct access to password configs" ON public.fanmark_password_configs
FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "Users can manage their own fanmark profiles" ON public.fanmark_profiles
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_profiles.license_id
        AND fl.user_id = auth.uid()
    )
);

-- Add triggers for updated_at
CREATE TRIGGER update_fanmark_basic_configs_updated_at
    BEFORE UPDATE ON public.fanmark_basic_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fanmark_redirect_configs_updated_at
    BEFORE UPDATE ON public.fanmark_redirect_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fanmark_messageboard_configs_updated_at
    BEFORE UPDATE ON public.fanmark_messageboard_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fanmark_password_configs_updated_at
    BEFORE UPDATE ON public.fanmark_password_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fanmark_profiles_updated_at
    BEFORE UPDATE ON public.fanmark_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Recreate functions with new structure

-- get_fanmark_complete_data with license_id
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
    has_active_license boolean,
    license_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        bc.fanmark_name,
        rc.target_url,
        mc.content as text_content,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = 'active' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license,
        fl.id as license_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$;

-- get_fanmark_by_emoji updated
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
    id uuid, 
    emoji_combination text, 
    fanmark_name text, 
    access_type text, 
    target_url text, 
    text_content text, 
    status text, 
    is_password_protected boolean, 
    short_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        COALESCE(pc.is_enabled, false) as is_password_protected,
        f.short_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.normalized_emoji = emoji_combo
    AND f.status = 'active';
END;
$function$;

-- get_fanmark_by_short_id updated
CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
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
SET search_path TO 'public'
AS $function$
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
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = 'active' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
    AND f.status = 'active';
END;
$function$;

-- upsert_fanmark_password_config with license_id
CREATE OR REPLACE FUNCTION public.upsert_fanmark_password_config(license_uuid uuid, new_password text, enable_password boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    config_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM public.fanmark_licenses fl
        WHERE fl.id = license_uuid 
          AND fl.user_id = auth.uid() 
          AND fl.status = 'active' 
          AND fl.license_end > now()
    ) THEN
        RAISE EXCEPTION 'Unauthorized: User does not have active license';
    END IF;

    INSERT INTO public.fanmark_password_configs (
        license_id,
        access_password,
        is_enabled
    ) VALUES (
        license_uuid,
        new_password,
        enable_password
    )
    ON CONFLICT (license_id) DO UPDATE SET
        access_password = EXCLUDED.access_password,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = now()
    RETURNING id INTO config_id;
    
    RETURN config_id;
END;
$function$;

-- get_public_emoji_profile with license_id
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_license_id uuid)
RETURNS TABLE(
    license_id uuid, 
    display_name text, 
    bio text, 
    social_links jsonb, 
    theme_settings jsonb, 
    created_at timestamp with time zone, 
    updated_at timestamp with time zone
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT 
        fp.license_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.created_at,
        fp.updated_at
    FROM public.fanmark_profiles fp
    WHERE fp.license_id = profile_license_id
        AND fp.is_public = true
    ORDER BY fp.updated_at DESC
    LIMIT 1;
$function$;