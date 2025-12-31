-- PHASE 1: Clear existing data and restructure tables (Clean slate version)

-- Clear existing data
DELETE FROM fanmarks;
DELETE FROM fanmark_licenses;

-- Drop existing function
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid);
DROP FUNCTION IF EXISTS public.get_public_fanmark_profile(uuid);

-- Drop views that depend on fanmarks columns
DROP VIEW IF EXISTS public.fanmark_search_auth_v1;
DROP VIEW IF EXISTS public.fanmark_search_public_v1;
DROP VIEW IF EXISTS public.my_fanmark_claims_v1;

-- Drop ALL existing tables that we're going to recreate
DROP TABLE IF EXISTS public.fanmark_profiles CASCADE;
DROP TABLE IF EXISTS public.fanmark_basic_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_redirect_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_messageboard_configs CASCADE;
DROP TABLE IF EXISTS public.fanmark_password_configs CASCADE;

-- Drop ALL existing RLS policies on fanmarks
DROP POLICY IF EXISTS "Users can create their own fanmarks" ON public.fanmarks;
DROP POLICY IF EXISTS "Users can update their own fanmarks" ON public.fanmarks;
DROP POLICY IF EXISTS "Users can view their own fanmarks" ON public.fanmarks;
DROP POLICY IF EXISTS "authenticated_search_fanmarks_limited" ON public.fanmarks;
DROP POLICY IF EXISTS "anonymous_no_direct_access" ON public.fanmarks;
DROP POLICY IF EXISTS "Fanmarks are accessible to authenticated users" ON public.fanmarks;

-- Remove columns from fanmarks table
ALTER TABLE fanmarks 
DROP COLUMN IF EXISTS user_id CASCADE,
DROP COLUMN IF EXISTS tier_level CASCADE,
DROP COLUMN IF EXISTS current_license_id CASCADE,
DROP COLUMN IF EXISTS is_transferable CASCADE,
DROP COLUMN IF EXISTS is_password_protected CASCADE,
DROP COLUMN IF EXISTS access_password CASCADE,
DROP COLUMN IF EXISTS fanmark_name CASCADE,
DROP COLUMN IF EXISTS target_url CASCADE,
DROP COLUMN IF EXISTS text_content CASCADE;

-- Simplify fanmark_licenses table
ALTER TABLE fanmark_licenses 
DROP COLUMN IF EXISTS tier_level CASCADE;

-- Create new simplified RLS policy for fanmarks table
CREATE POLICY "Fanmarks are accessible to authenticated users" 
ON public.fanmarks 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Create new fanmark_profiles table (renamed from emoji_profiles)
CREATE TABLE public.fanmark_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL,
  user_id UUID NOT NULL,
  display_name TEXT,
  bio TEXT,
  social_links JSONB DEFAULT '{}'::jsonb,
  theme_settings JSONB DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create fanmark_basic_configs table
CREATE TABLE public.fanmark_basic_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create fanmark_redirect_configs table
CREATE TABLE public.fanmark_redirect_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create fanmark_messageboard_configs table
CREATE TABLE public.fanmark_messageboard_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create fanmark_password_configs table
CREATE TABLE public.fanmark_password_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  access_password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.fanmark_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_basic_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_redirect_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_messageboard_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_password_configs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for fanmark_profiles
CREATE POLICY "Users can manage their own fanmark profiles" 
ON public.fanmark_profiles 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Public can view public fanmark profiles" 
ON public.fanmark_profiles 
FOR SELECT 
USING (is_public = true);

-- Create RLS policies for config tables
CREATE POLICY "Users can manage configs for their licensed fanmarks" 
ON public.fanmark_basic_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_basic_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  )
);

CREATE POLICY "Users can manage redirect configs for their licensed fanmarks" 
ON public.fanmark_redirect_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_redirect_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  )
);

CREATE POLICY "Users can manage messageboard configs for their licensed fanmarks" 
ON public.fanmark_messageboard_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_messageboard_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  )
);

CREATE POLICY "Users can manage password configs for their licensed fanmarks" 
ON public.fanmark_password_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_password_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  )
);

-- Create triggers for updated_at
CREATE TRIGGER update_fanmark_profiles_updated_at
BEFORE UPDATE ON public.fanmark_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

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

-- Create new function for public fanmark profile access
CREATE OR REPLACE FUNCTION public.get_public_fanmark_profile(profile_fanmark_id uuid)
RETURNS TABLE(id uuid, fanmark_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    fp.id,
    fp.fanmark_id,
    fp.display_name,
    fp.bio,
    fp.social_links,
    fp.theme_settings,
    fp.created_at,
    fp.updated_at
  FROM public.fanmark_profiles fp
  WHERE fp.fanmark_id = profile_fanmark_id 
    AND fp.is_public = true
  ORDER BY fp.updated_at DESC
  LIMIT 1;
END;
$function$;