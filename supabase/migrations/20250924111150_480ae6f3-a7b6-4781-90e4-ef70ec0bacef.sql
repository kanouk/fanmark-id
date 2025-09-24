-- Drop existing profile-related tables and views that are no longer needed
DROP VIEW IF EXISTS public_profiles CASCADE;
DROP TABLE IF EXISTS public_profile_cache CASCADE;

-- Drop existing profiles table
DROP TABLE IF EXISTS profiles CASCADE;

-- Create enum for user plan types
CREATE TYPE public.user_plan AS ENUM ('free', 'creator');

-- Create enum for supported languages
CREATE TYPE public.user_language AS ENUM ('en', 'ja');

-- Create simplified user_settings table
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  plan_type user_plan NOT NULL DEFAULT 'free',
  preferred_language user_language NOT NULL DEFAULT 'en',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_settings
CREATE POLICY "Users can view their own settings" 
ON public.user_settings 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings" 
ON public.user_settings 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings" 
ON public.user_settings 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create trigger for updating updated_at
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Update the handle_new_user function to work with new table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', 'user_' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    'free',
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'en')::user_language
  );
  RETURN NEW;
END;
$$;

-- Update admin check function to work with new table
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- For now, return false since we removed role from user_settings
  -- Admin functionality can be implemented separately if needed
  RETURN false;
END;
$$;

-- Update super admin function
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- For now, return false since we removed role from user_settings
  -- Super admin functionality can be implemented separately if needed
  RETURN false;
END;
$$;