SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict obXABgOhyNw1Rdf8RA8b2IuhgIGK4IenDUpttiCPPiSdZnb24ItaNsnOjV4EfYu

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: supabase_migrations; Owner: postgres
--

INSERT INTO "supabase_migrations"."schema_migrations" ("version", "statements", "name", "created_by", "idempotency_key", "rollback") VALUES
	('20250207090000', '{"-- Update favorite_fanmark_available notification copy to reflect return-in-progress messaging

-- Update Japanese template text
UPDATE public.notification_templates
SET
  title = ''お気に入りファンマが返却されました'',
  body = ''お気に入り登録していたファンマ「{{fanmark_name}}」が返却中です。まもなく再取得のチャンスが巡ってきます。'',
  summary = ''取得チャンスをお見逃しなく''
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = ''ja''
    AND title = ''お気に入りファンマークが利用可能''
  LIMIT 1
)
AND language = ''ja''","-- Update English template text (shares template_id with Japanese entry)
UPDATE public.notification_templates
SET
  title = ''Favorite fanmark is being returned'',
  body = ''Your favorited fanmark \"{{fanmark_name}}\" is currently being returned. Get ready to claim it again as soon as it reopens.'',
  summary = ''Return in progress—be ready''
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = ''ja''
    AND title = ''お気に入りファンマークが利用可能''
  LIMIT 1
)
AND language = ''en''"}', 'update_favorite_fanmark_notification', NULL, NULL, NULL),
	('20250215090000', '{"ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS amount INTEGER,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS interval TEXT,
  ADD COLUMN IF NOT EXISTS interval_count INTEGER"}', 'add_pricing_to_user_subscriptions', NULL, NULL, NULL),
	('20250920070229', '{"-- Fix the sync function permissions without SECURITY DEFINER
-- Grant the necessary permissions for the trigger function to work

-- Grant INSERT, UPDATE, DELETE permissions on public_profile_cache to public schema
GRANT INSERT, UPDATE, DELETE ON public.public_profile_cache TO PUBLIC","-- Recreate the function with proper permissions
CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = ''DELETE'' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$"}', '31173129-e8e9-4088-9be3-38b04c320157', NULL, NULL, NULL),
	('20250922130949', '{"-- Fix fanmarks UPDATE policy to allow status changes
DROP POLICY IF EXISTS \"Users can update their own fanmarks\" ON public.fanmarks","-- Create new UPDATE policy that allows status changes
CREATE POLICY \"Users can update their own fanmarks\" 
ON public.fanmarks 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)","-- Also update SELECT policy to allow users to see their own fanmarks regardless of status
DROP POLICY IF EXISTS \"Anyone can view active fanmarks\" ON public.fanmarks","-- Create separate policies for public viewing and owner viewing
CREATE POLICY \"Anyone can view active fanmarks\" 
ON public.fanmarks 
FOR SELECT 
USING (status = ''active'')","CREATE POLICY \"Users can view their own fanmarks\" 
ON public.fanmarks 
FOR SELECT 
USING (auth.uid() = user_id)"}', 'd701abd5-1caf-4e30-9398-a68cdd584c70', NULL, NULL, NULL),
	('20250923070911', '{"-- Fix fanmark_licenses table security vulnerability
-- Remove public access to license data while preserving legitimate functionality

-- Drop the overly permissive public read policy
DROP POLICY IF EXISTS \"read_active_or_grace_licenses_public\" ON public.fanmark_licenses","-- Create a secure function to check if a fanmark is currently licensed (without exposing user data)
CREATE OR REPLACE FUNCTION public.is_fanmark_licensed(fanmark_license_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''public''
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses 
    WHERE id = fanmark_license_id 
      AND status = ''active''
      AND license_end > now()
  );
$function$","-- Create a secure function to get minimal fanmark ownership info for search (without exposing user details)
CREATE OR REPLACE FUNCTION public.get_fanmark_ownership_status(fanmark_license_id uuid)
RETURNS TABLE(is_taken boolean, has_active_license boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''public''
AS $function$
  SELECT 
    CASE WHEN fl.id IS NOT NULL THEN true ELSE false END as is_taken,
    CASE WHEN fl.status = ''active'' AND fl.license_end > now() THEN true ELSE false END as has_active_license
  FROM public.fanmark_licenses fl
  WHERE fl.id = fanmark_license_id
  LIMIT 1;
$function$","-- The existing policies remain for legitimate access:
-- \"Only admins can manage all licenses\" - Admins can do everything
-- \"Users can view their own licenses\" - Users can see their own license data

-- Grant execute permissions on the new functions
GRANT EXECUTE ON FUNCTION public.is_fanmark_licensed(uuid) TO authenticated","GRANT EXECUTE ON FUNCTION public.is_fanmark_licensed(uuid) TO anon","GRANT EXECUTE ON FUNCTION public.get_fanmark_ownership_status(uuid) TO authenticated","GRANT EXECUTE ON FUNCTION public.get_fanmark_ownership_status(uuid) TO anon"}', '6dfaa46c-aa15-417d-b627-bcf181e26943', NULL, NULL, NULL),
	('20250924103705', '{"-- Fix security definer view by removing it and creating a function instead
DROP VIEW IF EXISTS fanmark_complete_view","-- Create a secure function to get complete fanmark data
CREATE OR REPLACE FUNCTION get_fanmark_complete_data(fanmark_id_param UUID DEFAULT NULL, emoji_combo_param TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    emoji_combination TEXT,
    normalized_emoji TEXT,
    short_id TEXT,
    access_type TEXT,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    fanmark_name TEXT,
    target_url TEXT,
    text_content TEXT,
    is_password_protected BOOLEAN,
    access_password TEXT,
    current_owner_id UUID,
    license_end TIMESTAMP WITH TIME ZONE,
    has_active_license BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        f.access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.display_name as fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public"}', '8473166d-6856-44cc-909b-1dd822bed611', NULL, NULL, NULL),
	('20251115094500', '{"-- Set up canonical key function, discovery catalog, favorites, and event logging for fanmarks

-- Ensure pgcrypto extension is available for deterministic hashing
CREATE EXTENSION IF NOT EXISTS \"pgcrypto\"","-- Deterministic sequence key derived from normalized emoji UUID array
CREATE OR REPLACE FUNCTION public.seq_key(normalized_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $function$
DECLARE
  hash_bytes bytea;
  hex text;
BEGIN
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION ''normalized_ids cannot be null or empty'';
  END IF;

  hash_bytes := digest(array_to_string(normalized_ids, '',''), ''sha1'');
  hex := encode(hash_bytes, ''hex'');

  RETURN (
    substr(hex, 1, 8) || ''-'' ||
    substr(hex, 9, 4) || ''-'' ||
    substr(hex, 13, 4) || ''-'' ||
    substr(hex, 17, 4) || ''-'' ||
    substr(hex, 21, 12)
  )::uuid;
END;
$function$","-- Add unique constraint on fanmarks using canonical sequence key
CREATE UNIQUE INDEX IF NOT EXISTS fanmarks_seq_key_idx
ON public.fanmarks (seq_key(normalized_emoji_ids))","-- Drop legacy favorites table to replace with new structure
DROP TABLE IF EXISTS public.fanmark_favorites","-- Catalog for discovered fanmarks (observed via search/favorite), including unclaimed ones
CREATE TABLE public.fanmark_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emoji_ids uuid[] NOT NULL,
  normalized_emoji_ids uuid[] NOT NULL,
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE SET NULL,
  availability_status text NOT NULL DEFAULT ''unknown'',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  search_count bigint NOT NULL DEFAULT 0,
  favorite_count bigint NOT NULL DEFAULT 0,
  CONSTRAINT fanmark_discoveries_availability_check
    CHECK (availability_status IN (''unknown'', ''unclaimed'', ''claimed_external'', ''owned_by_user''))
)","CREATE UNIQUE INDEX fanmark_discoveries_seq_key_idx
ON public.fanmark_discoveries (seq_key(normalized_emoji_ids))","CREATE INDEX fanmark_discoveries_fanmark_idx
ON public.fanmark_discoveries (fanmark_id)","CREATE INDEX fanmark_discoveries_last_seen_idx
ON public.fanmark_discoveries (last_seen_at DESC)","-- Favorites table referencing discovery catalog and optionally concrete fanmark
CREATE TABLE public.fanmark_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  discovery_id uuid NOT NULL REFERENCES public.fanmark_discoveries(id) ON DELETE CASCADE,
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE SET NULL,
  normalized_emoji_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)","CREATE UNIQUE INDEX fanmark_favorites_user_seq_idx
ON public.fanmark_favorites (user_id, seq_key(normalized_emoji_ids))","CREATE INDEX fanmark_favorites_user_idx
ON public.fanmark_favorites (user_id)","CREATE INDEX fanmark_favorites_fanmark_idx
ON public.fanmark_favorites (fanmark_id)","-- Optional event log for analytics / auditing
CREATE TABLE public.fanmark_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  user_id uuid,
  discovery_id uuid REFERENCES public.fanmark_discoveries(id) ON DELETE SET NULL,
  normalized_emoji_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)","CREATE INDEX fanmark_events_type_created_idx
ON public.fanmark_events (event_type, created_at DESC)","-- Enable and configure RLS policies
ALTER TABLE public.fanmark_discoveries ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_favorites ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_events ENABLE ROW LEVEL SECURITY","-- Allow all users to read discovery catalog (writes go through security definer RPCs)
DROP POLICY IF EXISTS \"Allow read discoveries\" ON public.fanmark_discoveries","CREATE POLICY \"Allow read discoveries\"
ON public.fanmark_discoveries
FOR SELECT
USING (true)","-- Allow authenticated users to manage their own favorites
DROP POLICY IF EXISTS \"Users manage favorites\" ON public.fanmark_favorites","CREATE POLICY \"Users manage favorites\"
ON public.fanmark_favorites
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)","-- Restrict events table to service/admin roles (no public access)
DROP POLICY IF EXISTS \"Allow read events\" ON public.fanmark_events","CREATE POLICY \"Allow read events\"
ON public.fanmark_events
FOR SELECT
USING (auth.role() = ''service_role'' OR is_admin())"}', 'setup_fanmark_discoveries', NULL, NULL, NULL),
	('20251209000644', '{"-- =====================================================
-- Fanmark Transfer System - Database Schema
-- =====================================================

-- 1. Add is_transferred column to fanmark_licenses
ALTER TABLE public.fanmark_licenses
ADD COLUMN IF NOT EXISTS is_transferred boolean NOT NULL DEFAULT false","-- 2. Create fanmark_transfer_codes table
CREATE TABLE public.fanmark_transfer_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_id uuid NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  issuer_user_id uuid NOT NULL,
  transfer_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT ''active'',
  expires_at timestamptz NOT NULL,
  disclaimer_agreed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_transfer_code_status CHECK (status IN (''active'', ''applied'', ''completed'', ''cancelled'', ''expired''))
)","-- 3. Create fanmark_transfer_requests table
CREATE TABLE public.fanmark_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_code_id uuid NOT NULL REFERENCES public.fanmark_transfer_codes(id) ON DELETE CASCADE,
  license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_id uuid NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT ''pending'',
  disclaimer_agreed_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_transfer_request_status CHECK (status IN (''pending'', ''approved'', ''rejected'', ''cancelled'', ''expired''))
)","-- 4. Create indexes
CREATE INDEX idx_transfer_codes_license_id ON public.fanmark_transfer_codes(license_id)","CREATE INDEX idx_transfer_codes_fanmark_id ON public.fanmark_transfer_codes(fanmark_id)","CREATE INDEX idx_transfer_codes_issuer_user_id ON public.fanmark_transfer_codes(issuer_user_id)","CREATE INDEX idx_transfer_codes_status ON public.fanmark_transfer_codes(status)","CREATE INDEX idx_transfer_codes_transfer_code ON public.fanmark_transfer_codes(transfer_code)","CREATE INDEX idx_transfer_requests_transfer_code_id ON public.fanmark_transfer_requests(transfer_code_id)","CREATE INDEX idx_transfer_requests_license_id ON public.fanmark_transfer_requests(license_id)","CREATE INDEX idx_transfer_requests_fanmark_id ON public.fanmark_transfer_requests(fanmark_id)","CREATE INDEX idx_transfer_requests_requester_user_id ON public.fanmark_transfer_requests(requester_user_id)","CREATE INDEX idx_transfer_requests_status ON public.fanmark_transfer_requests(status)","-- 5. Enable RLS
ALTER TABLE public.fanmark_transfer_codes ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_transfer_requests ENABLE ROW LEVEL SECURITY","-- 6. RLS Policies for fanmark_transfer_codes

-- Issuers can view their own codes
CREATE POLICY \"Issuers can view their own transfer codes\"
ON public.fanmark_transfer_codes
FOR SELECT
USING (auth.uid() = issuer_user_id)","-- Authenticated users can view active codes for validation (limited fields via function)
CREATE POLICY \"Authenticated users can validate transfer codes\"
ON public.fanmark_transfer_codes
FOR SELECT
USING (auth.uid() IS NOT NULL AND status = ''active'')","-- Issuers can cancel their active codes
CREATE POLICY \"Issuers can cancel their active transfer codes\"
ON public.fanmark_transfer_codes
FOR UPDATE
USING (auth.uid() = issuer_user_id AND status = ''active'')
WITH CHECK (status = ''cancelled'')","-- System/Admin can manage all codes
CREATE POLICY \"System can manage all transfer codes\"
ON public.fanmark_transfer_codes
FOR ALL
USING (auth.role() = ''service_role'' OR is_admin())","-- 7. RLS Policies for fanmark_transfer_requests

-- Requesters can view their own requests
CREATE POLICY \"Requesters can view their own transfer requests\"
ON public.fanmark_transfer_requests
FOR SELECT
USING (auth.uid() = requester_user_id)","-- Code issuers can view requests for their codes
CREATE POLICY \"Issuers can view requests for their codes\"
ON public.fanmark_transfer_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_transfer_codes tc
    WHERE tc.id = fanmark_transfer_requests.transfer_code_id
    AND tc.issuer_user_id = auth.uid()
  )
)","-- System/Admin can manage all requests
CREATE POLICY \"System can manage all transfer requests\"
ON public.fanmark_transfer_requests
FOR ALL
USING (auth.role() = ''service_role'' OR is_admin())","-- 8. Create updated_at triggers
CREATE TRIGGER update_fanmark_transfer_codes_updated_at
BEFORE UPDATE ON public.fanmark_transfer_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_transfer_requests_updated_at
BEFORE UPDATE ON public.fanmark_transfer_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- 9. Create helper function to check if license has active transfer
CREATE OR REPLACE FUNCTION public.has_active_transfer(license_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fanmark_transfer_codes
    WHERE license_id = license_uuid
    AND status IN (''active'', ''applied'')
  );
$$","-- 10. Create function to generate transfer code
CREATE OR REPLACE FUNCTION public.generate_transfer_code_string()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := ''ABCDEFGHJKLMNPQRSTUVWXYZ23456789'';
  result text := '''';
  i integer;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || ''-'';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || ''-'';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$"}', '50f324cf-f298-4550-8b11-59e89ebad020', NULL, NULL, NULL),
	('20250215120000', '{"-- Allow admin users (and service_role) to record audit logs
CREATE POLICY \"Admins can write audit logs\"
ON public.audit_logs
FOR INSERT
USING (public.is_admin() OR auth.role() = ''service_role'')
WITH CHECK (public.is_admin() OR auth.role() = ''service_role'')","-- Ensure default admin user has the admin role in user_roles
INSERT INTO public.user_roles (user_id, role, created_by)
SELECT u.id, ''admin''::public.app_role, u.id
FROM auth.users u
WHERE u.email = ''kanouk@gmail.com''
ON CONFLICT (user_id, role) DO NOTHING"}', 'add_audit_log_insert_policy', NULL, NULL, NULL),
	('20250920071603', '{"-- Fix linter error: Security Definer View and secure public profile caching
-- 1) Secure cache table by revoking public DML (in case previously granted)
REVOKE INSERT, UPDATE, DELETE ON public.public_profile_cache FROM PUBLIC, anon, authenticated","-- 2) Recreate sync function as SECURITY DEFINER so it can maintain the cache despite RLS
CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = ''DELETE'' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$","-- 3) Attach trigger to keep cache in sync
DROP TRIGGER IF EXISTS profiles_sync_public_profile_cache ON public.profiles","CREATE TRIGGER profiles_sync_public_profile_cache
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_cache()","-- 4) Recreate the public view to be SECURITY INVOKER and read only from cache
DROP VIEW IF EXISTS public.public_profiles","CREATE VIEW public.public_profiles WITH (security_invoker = true) AS
SELECT id, username, display_name, bio, avatar_url, created_at
FROM public.public_profile_cache","-- 5) Explicitly grant read access to the view (data is safe and governed by cache table policy)
GRANT SELECT ON public.public_profiles TO anon, authenticated"}', '7f03ec63-570a-44af-850a-712fbadde0e5', NULL, NULL, NULL),
	('20250922133325', '{"-- Update fanmarks status constraint to only allow active/inactive
ALTER TABLE fanmarks DROP CONSTRAINT IF EXISTS fanmarks_status_check","ALTER TABLE fanmarks ADD CONSTRAINT fanmarks_status_check CHECK (status IN (''active'', ''inactive''))","-- Update fanmark_licenses status constraint to include grace
ALTER TABLE fanmark_licenses DROP CONSTRAINT IF EXISTS fanmark_licenses_status_check","ALTER TABLE fanmark_licenses ADD CONSTRAINT fanmark_licenses_status_check CHECK (status IN (''active'', ''grace'', ''expired''))","-- Add grace period setting to system_settings
INSERT INTO system_settings (setting_key, setting_value, description, is_public) 
VALUES (''grace_period_days'', ''7'', ''Number of days for license grace period after expiration'', true)
ON CONFLICT (setting_key) DO UPDATE SET 
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public"}', '2c3ea6a4-746e-40fa-b284-5dcbc76513a2', NULL, NULL, NULL),
	('20250923142845', '{"-- Fix fanmarks table security - remove anonymous access to user data
-- Remove the overly permissive anonymous access policy
DROP POLICY IF EXISTS \"anonymous_search_fanmarks_limited\" ON public.fanmarks","-- Create a more secure anonymous access policy that doesn''t expose user data
-- Anonymous users should only access fanmarks through the secure get_fanmark_by_emoji function
-- This policy effectively blocks direct anonymous access to the table
CREATE POLICY \"anonymous_no_direct_access\" ON public.fanmarks
  FOR SELECT 
  USING (
    auth.uid() IS NULL AND false  -- Explicitly deny anonymous direct access
  )","-- Ensure the get_fanmark_by_emoji function has proper permissions for anonymous access
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO anon","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO authenticated","-- Update the authenticated search policy to be more restrictive
-- Authenticated users should only see limited data when searching (not user_id)
DROP POLICY IF EXISTS \"authenticated_search_fanmarks_limited\" ON public.fanmarks","CREATE POLICY \"authenticated_search_fanmarks_limited\" ON public.fanmarks
  FOR SELECT 
  USING (
    status = ''active'' 
    AND auth.uid() IS NOT NULL 
    AND auth.uid() != user_id
  )"}', '18059820-5323-462d-a281-b6389a487969', NULL, NULL, NULL),
	('20250924154659', '{"-- Create cover-images storage bucket for high-quality cover image uploads
INSERT INTO storage.buckets (id, name, public) VALUES (''cover-images'', ''cover-images'', true)","-- Create storage policies for cover images
CREATE POLICY \"Cover images are publicly accessible\" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = ''cover-images'')","CREATE POLICY \"Users can upload their own cover images\" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = ''cover-images'' AND auth.uid()::text = (storage.foldername(name))[1])","CREATE POLICY \"Users can update their own cover images\" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = ''cover-images'' AND auth.uid()::text = (storage.foldername(name))[1])","CREATE POLICY \"Users can delete their own cover images\" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = ''cover-images'' AND auth.uid()::text = (storage.foldername(name))[1])"}', 'efa45c41-1c50-4931-99b5-dfdb0cc1b37b', NULL, NULL, NULL),
	('20251115095500', '{"DROP FUNCTION IF EXISTS public.get_favorite_fanmarks()","CREATE OR REPLACE FUNCTION public.upsert_fanmark_discovery(input_emoji_ids uuid[], increment_search boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  normalized_ids uuid[];
  discovery_id uuid;
  search_increment int := CASE WHEN increment_search THEN 1 ELSE 0 END;
BEGIN
  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION ''Invalid emoji ids'';
  END IF;

  INSERT INTO public.fanmark_discoveries (
    emoji_ids,
    normalized_emoji_ids,
    last_seen_at,
    search_count
  )
  VALUES (
    input_emoji_ids,
    normalized_ids,
    now(),
    search_increment
  )
  ON CONFLICT (seq_key(normalized_emoji_ids))
  DO UPDATE SET
    emoji_ids = EXCLUDED.emoji_ids,
    last_seen_at = now(),
    search_count = public.fanmark_discoveries.search_count + search_increment
  RETURNING id INTO discovery_id;

  IF discovery_id IS NULL THEN
    SELECT id INTO discovery_id
    FROM public.fanmark_discoveries
    WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
    LIMIT 1;
  END IF;

  RETURN discovery_id;
END;
$function$","CREATE OR REPLACE FUNCTION public.record_fanmark_search(input_emoji_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  discovery_id uuid;
  auth_user_id uuid;
BEGIN
  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, true);
  SELECT auth.uid() INTO auth_user_id;
  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES (''search'', auth_user_id, discovery_id, public.normalize_emoji_ids(input_emoji_ids));
  RETURN discovery_id;
END;
$function$","CREATE OR REPLACE FUNCTION public.add_fanmark_favorite(input_emoji_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION ''Authentication required'';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION ''Invalid emoji ids'';
  END IF;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  SELECT fanmark_id INTO linked_fanmark_id
  FROM public.fanmark_discoveries
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids
  )
  VALUES (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids
  )
  ON CONFLICT (user_id, seq_key(normalized_emoji_ids))
  DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = favorite_count + 1
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES (''favorite_add'', auth_user_id, discovery_id, normalized_ids);

  RETURN true;
END;
$function$","CREATE OR REPLACE FUNCTION public.remove_fanmark_favorite(input_emoji_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  deleted_record RECORD;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION ''Authentication required'';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION ''Invalid emoji ids'';
  END IF;

  DELETE FROM public.fanmark_favorites
  WHERE user_id = auth_user_id
    AND normalized_emoji_ids = normalized_ids
  RETURNING discovery_id INTO deleted_record;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = GREATEST(favorite_count - 1, 0)
  WHERE id = deleted_record.discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES (''favorite_remove'', auth_user_id, deleted_record.discovery_id, normalized_ids);

  RETURN true;
END;
$function$","CREATE OR REPLACE FUNCTION public.get_favorite_fanmarks()
RETURNS TABLE(
  favorite_id uuid,
  discovery_id uuid,
  favorited_at timestamptz,
  fanmark_id uuid,
  normalized_emoji_ids uuid[],
  emoji_ids uuid[],
  sequence_key uuid,
  availability_status text,
  search_count bigint,
  favorite_count bigint,
  short_id text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamptz,
  current_license_end timestamptz,
  current_license_status text,
  is_password_protected boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION ''Authentication required'';
  END IF;

  RETURN QUERY
  SELECT
    ff.id AS favorite_id,
    ff.discovery_id,
    ff.created_at AS favorited_at,
    d.fanmark_id,
    ff.normalized_emoji_ids,
    d.emoji_ids,
    seq_key(d.normalized_emoji_ids) AS sequence_key,
    d.availability_status,
    d.search_count,
    d.favorite_count,
    f.short_id,
    bc.fanmark_name,
    bc.access_type,
    rc.target_url,
    mc.content AS text_content,
    us.username AS current_owner_username,
    us.display_name AS current_owner_display_name,
    fl.license_start AS current_license_start,
    fl.license_end AS current_license_end,
    fl.status AS current_license_status,
    COALESCE(pc.is_enabled, false) AS is_password_protected
  FROM public.fanmark_favorites ff
  JOIN public.fanmark_discoveries d ON d.id = ff.discovery_id
  LEFT JOIN public.fanmarks f ON f.id = d.fanmark_id
  LEFT JOIN LATERAL (
    SELECT fl_inner.*
    FROM public.fanmark_licenses fl_inner
    WHERE fl_inner.fanmark_id = f.id
    ORDER BY fl_inner.license_end DESC NULLS LAST
    LIMIT 1
  ) fl ON true
  LEFT JOIN public.user_settings us ON us.user_id = fl.user_id
  LEFT JOIN public.fanmark_basic_configs bc ON bc.license_id = fl.id
  LEFT JOIN public.fanmark_redirect_configs rc ON rc.license_id = fl.id
  LEFT JOIN public.fanmark_messageboard_configs mc ON mc.license_id = fl.id
  LEFT JOIN public.fanmark_password_configs pc ON pc.license_id = fl.id
  WHERE ff.user_id = auth_user_id
  ORDER BY ff.created_at DESC;
END;
$function$","GRANT EXECUTE ON FUNCTION public.record_fanmark_search(uuid[]) TO authenticated, anon","GRANT EXECUTE ON FUNCTION public.add_fanmark_favorite(uuid[]) TO authenticated","GRANT EXECUTE ON FUNCTION public.remove_fanmark_favorite(uuid[]) TO authenticated","GRANT EXECUTE ON FUNCTION public.get_favorite_fanmarks() TO authenticated"}', 'fanmark_functions', NULL, NULL, NULL),
	('20251209131555', '{"-- Add requester_username column to fanmark_transfer_requests
ALTER TABLE fanmark_transfer_requests ADD COLUMN IF NOT EXISTS requester_username text"}', '99b40161-2ca3-4460-b44f-f03c7df5ceaa', NULL, NULL, NULL),
	('20250313093000', '{"-- Create emoji master table for canonical emoji metadata
create table if not exists public.emoji_master (
  id uuid primary key default gen_random_uuid(),
  emoji text not null unique,
  short_name text not null,
  keywords text[] not null default ''{}'',
  category text,
  subcategory text,
  codepoints text[] not null,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)","comment on table public.emoji_master is ''Canonical emoji master data used for normalization and lookup.''","create index if not exists idx_emoji_master_short_name on public.emoji_master using gin (to_tsvector(''simple'', short_name))","create index if not exists idx_emoji_master_keywords on public.emoji_master using gin (keywords)","create index if not exists idx_emoji_master_category on public.emoji_master (category, subcategory)","alter table public.emoji_master enable row level security","-- Only admin users may manage emoji master records
create policy \"Admins can manage emoji master\"
on public.emoji_master
for all
using (public.is_admin())
with check (public.is_admin())","-- Maintain updated_at
create trigger update_emoji_master_updated_at
  before update on public.emoji_master
  for each row
  execute function public.update_updated_at_column()"}', 'emoji_master', NULL, NULL, NULL),
	('20250920073347', '{"-- Create fanmarks table for emoji combinations
CREATE TABLE public.fanmarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  emoji_combination TEXT NOT NULL,
  normalized_emoji TEXT NOT NULL,
  short_id TEXT NOT NULL UNIQUE,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT ''active'',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT fanmarks_emoji_combination_unique UNIQUE (normalized_emoji),
  CONSTRAINT fanmarks_short_id_length CHECK (char_length(short_id) >= 6),
  CONSTRAINT fanmarks_status_valid CHECK (status IN (''active'', ''reserved'', ''banned''))
)","-- Enable RLS on fanmarks
ALTER TABLE public.fanmarks ENABLE ROW LEVEL SECURITY","-- Create RLS policies for fanmarks
CREATE POLICY \"Anyone can view active fanmarks\" 
ON public.fanmarks 
FOR SELECT 
USING (status = ''active'')","CREATE POLICY \"Users can create their own fanmarks\" 
ON public.fanmarks 
FOR INSERT 
WITH CHECK (auth.uid() = user_id)","CREATE POLICY \"Users can update their own fanmarks\" 
ON public.fanmarks 
FOR UPDATE 
USING (auth.uid() = user_id)","-- Create invitation_codes table
CREATE TABLE public.invitation_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  special_perks JSONB DEFAULT ''{}'',
  created_by UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT invitation_codes_code_format CHECK (code ~ ''^[A-Z0-9]{6,12}$''),
  CONSTRAINT invitation_codes_max_uses_positive CHECK (max_uses > 0),
  CONSTRAINT invitation_codes_used_count_valid CHECK (used_count >= 0 AND used_count <= max_uses)
)","-- Enable RLS on invitation_codes
ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY","-- Create RLS policies for invitation_codes (only allow checking validity, not viewing details)
CREATE POLICY \"Anyone can validate invitation codes\" 
ON public.invitation_codes 
FOR SELECT 
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()) AND used_count < max_uses)","-- Create system_settings table
CREATE TABLE public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT system_settings_key_format CHECK (setting_key ~ ''^[a-z_]+$'')
)","-- Enable RLS on system_settings
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY","-- Create RLS policies for system_settings
CREATE POLICY \"Anyone can view public settings\" 
ON public.system_settings 
FOR SELECT 
USING (is_public = true)","-- Create waitlist table
CREATE TABLE public.waitlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  referral_source TEXT,
  status TEXT NOT NULL DEFAULT ''waiting'',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT waitlist_email_format CHECK (email ~* ''^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$''),
  CONSTRAINT waitlist_status_valid CHECK (status IN (''waiting'', ''invited'', ''converted''))
)","-- Enable RLS on waitlist
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY","-- Create RLS policies for waitlist (users can only add themselves)
CREATE POLICY \"Anyone can join waitlist\" 
ON public.waitlist 
FOR INSERT 
WITH CHECK (true)","-- Add invitation tracking to profiles table
ALTER TABLE public.profiles 
ADD COLUMN invited_by_code TEXT,
ADD COLUMN invitation_perks JSONB DEFAULT ''{}''","-- Create indexes for performance
CREATE INDEX idx_fanmarks_normalized_emoji ON public.fanmarks(normalized_emoji)","CREATE INDEX idx_fanmarks_user_id ON public.fanmarks(user_id)","CREATE INDEX idx_fanmarks_status ON public.fanmarks(status)","CREATE INDEX idx_invitation_codes_code ON public.invitation_codes(code)","CREATE INDEX idx_invitation_codes_active ON public.invitation_codes(is_active, expires_at)","CREATE INDEX idx_system_settings_key ON public.system_settings(setting_key)","CREATE INDEX idx_waitlist_email ON public.waitlist(email)","-- Insert default system settings
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public) VALUES
(''invitation_mode'', ''false'', ''Whether the system is in invitation-only mode'', true),
(''max_fanmarks_per_user'', ''10'', ''Maximum fanmarks a user can create'', true),
(''premium_pricing'', ''1000'', ''Price for premium fanmarks in yen'', true)","-- Create triggers for updated_at
CREATE TRIGGER update_fanmarks_updated_at
  BEFORE UPDATE ON public.fanmarks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_invitation_codes_updated_at
  BEFORE UPDATE ON public.invitation_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column()"}', 'c7aa742a-4dbe-4a2d-99ac-86ed1881333f', NULL, NULL, NULL),
	('20250922135933', '{"-- Fix security issue: Restrict license management to admins only
DROP POLICY IF EXISTS \"System can manage licenses\" ON public.fanmark_licenses","-- Create a more secure policy that only allows admins to manage all licenses
CREATE POLICY \"Only admins can manage all licenses\" 
ON public.fanmark_licenses
FOR ALL
USING (is_admin())
WITH CHECK (is_admin())","-- Keep the existing policy for users to view their own licenses
-- (This policy already exists and is secure)"}', '12c44eb4-d56b-4047-afec-db74a4cbf29a', NULL, NULL, NULL),
	('20250923143742', '{"-- Update Free user fanmark limit from 10 to 3
UPDATE public.system_settings 
SET setting_value = ''3'', updated_at = now()
WHERE setting_key = ''max_fanmarks_per_user'' AND is_public = true"}', '4229d04e-0807-431d-946c-6c30bb76f7ba', NULL, NULL, NULL),
	('20250924111150', '{"-- Drop existing profile-related tables and views that are no longer needed
DROP VIEW IF EXISTS public_profiles CASCADE","DROP TABLE IF EXISTS public_profile_cache CASCADE","-- Drop existing profiles table
DROP TABLE IF EXISTS profiles CASCADE","-- Create enum for user plan types
CREATE TYPE public.user_plan AS ENUM (''free'', ''creator'')","-- Create enum for supported languages
CREATE TYPE public.user_language AS ENUM (''en'', ''ja'')","-- Create simplified user_settings table
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  plan_type user_plan NOT NULL DEFAULT ''free'',
  preferred_language user_language NOT NULL DEFAULT ''en'',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Enable RLS on user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY","-- Create RLS policies for user_settings
CREATE POLICY \"Users can view their own settings\" 
ON public.user_settings 
FOR SELECT 
USING (auth.uid() = user_id)","CREATE POLICY \"Users can insert their own settings\" 
ON public.user_settings 
FOR INSERT 
WITH CHECK (auth.uid() = user_id)","CREATE POLICY \"Users can update their own settings\" 
ON public.user_settings 
FOR UPDATE 
USING (auth.uid() = user_id)","-- Create trigger for updating updated_at
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column()","-- Update the handle_new_user function to work with new table
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
    COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> ''display_name'',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    ''free'',
    COALESCE(NEW.raw_user_meta_data ->> ''preferred_language'', ''en'')::user_language
  );
  RETURN NEW;
END;
$$","-- Update admin check function to work with new table
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
$$","-- Update super admin function
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
$$"}', '480ae6f3-a7b6-4781-90e4-ef70ec0bacef', NULL, NULL, NULL),
	('20251209135327', '{"-- Add requester_display_name column to fanmark_transfer_requests
ALTER TABLE fanmark_transfer_requests 
ADD COLUMN IF NOT EXISTS requester_display_name text"}', '283a880f-040d-4a1c-8585-534072522c54', NULL, NULL, NULL),
	('20250313120000', '{"-- Add emoji_ids column to fanmarks for ID-based emoji handling

ALTER TABLE public.fanmarks
  ADD COLUMN IF NOT EXISTS emoji_ids uuid[] NOT NULL DEFAULT ''{}''::uuid[]","CREATE INDEX IF NOT EXISTS idx_fanmarks_emoji_ids ON public.fanmarks USING gin (emoji_ids)"}', 'add_emoji_ids', NULL, NULL, NULL),
	('20250920081239', '{"-- Fix security issue: Add RLS policies to public_profiles view
-- The public_profiles view should be read-only and accessible to everyone
-- but should not allow any modifications

-- Enable RLS on the public_profiles view
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY","-- Allow anyone to view public profiles (read-only access)
CREATE POLICY \"Anyone can view public profiles\" 
ON public.public_profiles 
FOR SELECT 
USING (true)","-- Explicitly deny all modification operations on the view
-- This ensures the view remains read-only
CREATE POLICY \"No modifications allowed on public profiles view\" 
ON public.public_profiles 
FOR ALL
USING (false)"}', '5e9156a1-954d-42c9-9f38-966cd970f3e5', NULL, NULL, NULL),
	('20250922140221', '{"-- Fix security issue: Remove public access to sensitive fanmark data
DROP POLICY IF EXISTS \"Anyone can view active fanmarks\" ON public.fanmarks","-- Create a secure function that returns only essential data for public emoji access
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
  emoji_combination text,
  display_name text,
  access_type text,
  target_url text,
  text_content text,
  status text
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    f.emoji_combination,
    f.display_name,
    f.access_type,
    f.target_url,
    f.text_content,
    f.status
  FROM public.fanmarks f
  WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active''
  LIMIT 1;
$$","-- Grant execute permission to anonymous users for emoji access
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO anon","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO authenticated"}', '713830ca-3f0c-4e5b-9112-cce6cf3a58d5', NULL, NULL, NULL),
	('20250923234228', '{"-- Add password protection columns to fanmarks table
ALTER TABLE public.fanmarks 
ADD COLUMN is_password_protected boolean NOT NULL DEFAULT false,
ADD COLUMN access_password text","-- Drop and recreate the get_fanmark_by_emoji function to include password protection info
DROP FUNCTION public.get_fanmark_by_emoji(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(emoji_combination text, display_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
  SELECT 
    f.emoji_combination,
    f.display_name,
    f.access_type,
    f.target_url,
    f.text_content,
    f.status,
    f.is_password_protected,
    f.access_password
  FROM public.fanmarks f
  WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active''
  LIMIT 1;
$function$"}', 'a8c23587-a236-4eec-a834-8b59448b25b7', NULL, NULL, NULL),
	('20250924111232', '{"-- Fix function search path issues by explicitly setting search_path for all functions
CREATE OR REPLACE FUNCTION public.validate_invitation_code(code_to_check text)
RETURNS TABLE(is_valid boolean, special_perks jsonb, remaining_uses integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, ''{}''::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$$","CREATE OR REPLACE FUNCTION public.use_invitation_code(code_to_use text)
RETURNS TABLE(success boolean, special_perks jsonb, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ''{}''::jsonb, ''Invalid or expired invitation code''::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''''::text;
END;
$$","CREATE OR REPLACE FUNCTION public.get_waitlist_secure(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, email_hash text, referral_source text, status text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Verify admin access with enhanced security
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_WAITLIST_ACCESS'',
      ''waitlist'',
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''ip_address'', COALESCE(current_setting(''request.headers'', true)::json->>''x-forwarded-for'', ''unknown''),
        ''attempted_action'', ''get_waitlist_secure'',
        ''security_level'', ''HIGH_RISK''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to waitlist data'';
  END IF;

  -- Log authorized admin access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    ''AUTHORIZED_WAITLIST_ACCESS'',
    ''waitlist'',
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''record_count'', (SELECT COUNT(*) FROM public.waitlist),
      ''limit'', p_limit,
      ''offset'', p_offset,
      ''security_level'', ''ADMIN_VERIFIED''
    )
  );

  -- Return waitlist data with email hashed for additional security
  RETURN QUERY
  SELECT 
    w.id,
    encode(digest(w.email, ''sha256''), ''hex'') as email_hash,  -- Hash email for privacy
    w.referral_source,
    w.status,
    w.created_at
  FROM public.waitlist w
  ORDER BY w.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$","CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_EMAIL_ACCESS'',
      ''waitlist'',
      waitlist_id::text,
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''security_level'', ''CRITICAL_RISK'',
        ''attempted_resource'', ''email_address''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to email data'';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    ''EMAIL_ACCESS'',
    ''waitlist'',
    waitlist_id::text,
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''security_level'', ''ADMIN_VERIFIED'',
      ''purpose'', ''email_retrieval''
    )
  );

  RETURN email_result;
END;
$$"}', 'f5368c84-89ec-4d34-a98c-c671d8ed0a8b', NULL, NULL, NULL),
	('20250924230259', '{"-- Add is_enabled column to fanmark_password_configs table
ALTER TABLE public.fanmark_password_configs 
ADD COLUMN is_enabled boolean NOT NULL DEFAULT true","-- Update get_fanmark_by_emoji function to consider is_enabled flag
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(id uuid, emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        CASE WHEN pc.access_password IS NOT NULL AND pc.is_enabled = true THEN true ELSE false END as is_password_protected,
        CASE WHEN pc.is_enabled = true THEN pc.access_password ELSE NULL END as access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active'';
END;
$function$","-- Update get_fanmark_complete_data function to consider is_enabled flag
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, access_password text, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection with is_enabled flag
        CASE WHEN pc.access_password IS NOT NULL AND pc.is_enabled = true THEN true ELSE false END as is_password_protected,
        CASE WHEN pc.is_enabled = true THEN pc.access_password ELSE NULL END as access_password,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$"}', 'a91abee2-d6f3-4c28-8ff0-8bc8393d4797', NULL, NULL, NULL),
	('20251102235058', '{"-- Allow anyone to view active fanmarks
-- This complements the fanmark_licenses policy for the RecentFanmarksScroll component
-- Security: Only emoji and basic fanmark info are exposed, no personal data

CREATE POLICY \"Anyone can view active fanmarks\"
ON public.fanmarks
FOR SELECT
TO public
USING (status = ''active'')"}', 'ca0991ae-8360-4404-952d-51b55cf0e272', NULL, NULL, NULL),
	('20250601090000', '{"-- Add social_login_enabled system setting (default true)
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public, created_at, updated_at)
VALUES (
  ''social_login_enabled'',
  ''true'',
  ''Toggle to allow or disable social (OAuth) login/signup from the product UI'',
  true,
  now(),
  now()
)
ON CONFLICT (setting_key) DO UPDATE
SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public,
  updated_at = now()","-- Extend user_settings to track password setup requirement
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS requires_password_setup boolean NOT NULL DEFAULT false","COMMENT ON COLUMN public.user_settings.requires_password_setup IS
  ''Indicates that the user must complete password setup before accessing the app''","-- Ensure existing OAuth users without a password are flagged
UPDATE public.user_settings us
SET requires_password_setup = true
FROM auth.users u
WHERE us.user_id = u.id
  AND (
    u.raw_user_meta_data ? ''iss''
    OR u.raw_user_meta_data ? ''provider''
    OR u.raw_user_meta_data ? ''provider_id''
  )
  AND (u.encrypted_password IS NULL OR u.encrypted_password = '''')","-- Update handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  invitation_mode_enabled text;
  social_login_enabled text;
  invitation_code text;
  validation_result record;
  use_code_result record;
  is_oauth_user boolean;
BEGIN
  -- Determine if this signup came from an OAuth provider
  is_oauth_user := (
    NEW.raw_user_meta_data ? ''iss'' OR
    NEW.raw_user_meta_data ? ''provider'' OR
    NEW.raw_user_meta_data ? ''provider_id''
  );

  -- Fetch invitation mode flag
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = ''invitation_mode'';

  -- Fetch social login toggle (defaults to true when missing)
  SELECT setting_value INTO social_login_enabled
  FROM public.system_settings
  WHERE setting_key = ''social_login_enabled'';

  IF social_login_enabled IS NULL THEN
    social_login_enabled := ''true'';
  END IF;

  -- Block OAuth signups when invitation mode is active or social login is disabled
  IF is_oauth_user THEN
    IF invitation_mode_enabled = ''true'' THEN
      RAISE EXCEPTION ''Social login is not allowed while invitation mode is active'';
    END IF;

    IF social_login_enabled = ''false'' THEN
      RAISE EXCEPTION ''Social login is currently disabled'';
    END IF;
  END IF;

  -- For email/password signups, enforce invitation code when required
  IF invitation_mode_enabled = ''true'' AND NOT is_oauth_user THEN
    invitation_code := NEW.raw_user_meta_data ->> ''invitation_code'';

    IF invitation_code IS NULL OR invitation_code = '''' THEN
      RAISE EXCEPTION ''Invitation code is required for sign-up'';
    END IF;

    SELECT is_valid INTO validation_result
    FROM public.validate_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR validation_result.is_valid = false THEN
      RAISE EXCEPTION ''Invalid invitation code: %'', invitation_code;
    END IF;

    SELECT success INTO use_code_result
    FROM public.use_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR use_code_result.success = false THEN
      RAISE EXCEPTION ''Failed to use invitation code: %'', invitation_code;
    END IF;
  END IF;

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> ''display_name'',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    ''free'',
    COALESCE(NEW.raw_user_meta_data ->> ''preferred_language'', ''en'')::user_language,
    CASE WHEN NOT is_oauth_user THEN NEW.raw_user_meta_data ->> ''invitation_code'' ELSE NULL END,
    CASE WHEN is_oauth_user THEN true ELSE false END
  );

  RETURN NEW;
END;
$function$"}', 'auth_refactor_invitation_social', NULL, NULL, NULL),
	('20250920081341', '{"-- Fix security issue: Recreate public_profiles as a secure view
-- Drop the existing view first
DROP VIEW IF EXISTS public.public_profiles","-- Create a secure view that only shows profiles marked as public
-- This references the profiles table which already has proper RLS policies
CREATE VIEW public.public_profiles AS
SELECT 
    p.id,
    p.username,
    p.display_name,
    p.bio,
    p.avatar_url,
    p.created_at
FROM public.profiles p
WHERE p.is_public_profile = true","-- Grant SELECT permissions to authenticated and anonymous users
GRANT SELECT ON public.public_profiles TO authenticated","GRANT SELECT ON public.public_profiles TO anon"}', 'dcea336b-74ae-4a03-8752-be80b8c57bf3', NULL, NULL, NULL),
	('20250922140513', '{"-- Fix security issue: Remove public access to invitation codes
DROP POLICY IF EXISTS \"Anyone can validate invitation codes\" ON public.invitation_codes","-- Create a secure function to validate invitation codes without exposing them
CREATE OR REPLACE FUNCTION public.validate_invitation_code(code_to_check text)
RETURNS TABLE(
  is_valid boolean,
  special_perks jsonb,
  remaining_uses integer
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, ''{}''::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$$","-- Create a function to increment invitation code usage (for registration process)
CREATE OR REPLACE FUNCTION public.use_invitation_code(code_to_use text)
RETURNS TABLE(
  success boolean,
  special_perks jsonb,
  error_message text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ''{}''::jsonb, ''Invalid or expired invitation code''::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''''::text;
END;
$$","-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.validate_invitation_code(text) TO anon","GRANT EXECUTE ON FUNCTION public.validate_invitation_code(text) TO authenticated","GRANT EXECUTE ON FUNCTION public.use_invitation_code(text) TO anon","GRANT EXECUTE ON FUNCTION public.use_invitation_code(text) TO authenticated"}', '47c7160b-a407-4f7c-810a-093bd397b88d', NULL, NULL, NULL),
	('20250924073234', '{"-- Add display_name column to emoji_profiles table
ALTER TABLE public.emoji_profiles 
ADD COLUMN display_name text","-- Add comment to clarify the concept difference
COMMENT ON COLUMN public.emoji_profiles.display_name IS ''プロフィール編集画面での表示名（fanmarks.display_nameとは別概念）''"}', 'aca992a5-5e88-42f5-90ca-4b75b51ec802', NULL, NULL, NULL),
	('20250924111313', '{"-- Fix function search path issues by explicitly setting search_path for all functions
CREATE OR REPLACE FUNCTION public.validate_invitation_code(code_to_check text)
RETURNS TABLE(is_valid boolean, special_perks jsonb, remaining_uses integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, ''{}''::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$$","CREATE OR REPLACE FUNCTION public.use_invitation_code(code_to_use text)
RETURNS TABLE(success boolean, special_perks jsonb, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ''{}''::jsonb, ''Invalid or expired invitation code''::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''''::text;
END;
$$","CREATE OR REPLACE FUNCTION public.get_waitlist_secure(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, email_hash text, referral_source text, status text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Verify admin access with enhanced security
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_WAITLIST_ACCESS'',
      ''waitlist'',
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''ip_address'', COALESCE(current_setting(''request.headers'', true)::json->>''x-forwarded-for'', ''unknown''),
        ''attempted_action'', ''get_waitlist_secure'',
        ''security_level'', ''HIGH_RISK''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to waitlist data'';
  END IF;

  -- Log authorized admin access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    ''AUTHORIZED_WAITLIST_ACCESS'',
    ''waitlist'',
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''record_count'', (SELECT COUNT(*) FROM public.waitlist),
      ''limit'', p_limit,
      ''offset'', p_offset,
      ''security_level'', ''ADMIN_VERIFIED''
    )
  );

  -- Return waitlist data with email hashed for additional security
  RETURN QUERY
  SELECT 
    w.id,
    encode(digest(w.email, ''sha256''), ''hex'') as email_hash,  -- Hash email for privacy
    w.referral_source,
    w.status,
    w.created_at
  FROM public.waitlist w
  ORDER BY w.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$","CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_EMAIL_ACCESS'',
      ''waitlist'',
      waitlist_id::text,
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''security_level'', ''CRITICAL_RISK'',
        ''attempted_resource'', ''email_address''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to email data'';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    ''EMAIL_ACCESS'',
    ''waitlist'',
    waitlist_id::text,
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''security_level'', ''ADMIN_VERIFIED'',
      ''purpose'', ''email_retrieval''
    )
  );

  RETURN email_result;
END;
$$"}', '63459630-b5c4-4271-8458-e2d91e9e3310', NULL, NULL, NULL),
	('20250924235703', '{"-- Fix security vulnerability: Remove overly permissive RLS policy that exposes user data
-- and replace with secure availability checking

-- First, drop the problematic policy that exposes user data
DROP POLICY IF EXISTS \"Anyone can check fanmark license status for availability\" ON public.fanmark_licenses","-- Create a secure function to check fanmark availability without exposing user data
CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_emoji text)
RETURNS boolean AS $$
BEGIN
  -- Check if fanmark exists and has an active license
  RETURN NOT EXISTS (
    SELECT 1 
    FROM public.fanmarks f
    JOIN public.fanmark_licenses fl ON f.id = fl.fanmark_id
    WHERE f.emoji_combination = fanmark_emoji 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","-- Update the existing check_fanmark_availability function to use the secure approach
CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji text)
RETURNS json AS $$
DECLARE
  fanmark_record RECORD;
  is_available boolean;
  tier_info RECORD;
  result json;
BEGIN
  -- Normalize the emoji input by removing skin tone modifiers
  input_emoji := regexp_replace(input_emoji, ''[\\x{1F3FB}-\\x{1F3FF}]'', '''', ''g'');
  
  -- Check if fanmark exists
  SELECT id, emoji_combination, status INTO fanmark_record
  FROM public.fanmarks 
  WHERE normalized_emoji = input_emoji;
  
  IF NOT FOUND THEN
    -- Fanmark doesn''t exist, check if it can be created
    SELECT tier_level, monthly_price_usd, initial_license_days 
    INTO tier_info
    FROM public.fanmark_tiers 
    WHERE char_length(input_emoji) BETWEEN emoji_count_min AND emoji_count_max
    AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;
    
    IF FOUND THEN
      result := json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days
      );
    ELSE
      result := json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  ELSE
    -- Fanmark exists, check if it''s available (no active license)
    is_available := public.check_fanmark_availability_secure(fanmark_record.emoji_combination);
    
    result := json_build_object(
      ''available'', is_available,
      ''fanmark_id'', fanmark_record.id,
      ''reason'', CASE WHEN NOT is_available THEN ''taken'' ELSE null END
    );
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public"}', '7087f0a4-4f66-4d71-8430-44359e5ec043', NULL, NULL, NULL),
	('20251002120954', '{"-- Phase 1: Emergency fix for 🍔🍟 license
-- Update the active but expired license to grace status
UPDATE fanmark_licenses
SET 
  status = ''grace'',
  updated_at = now()
WHERE id = ''b91277ae-a72c-4c8d-b14c-7d40be66522d''
  AND status = ''active''
  AND license_end < now()","-- Phase 3: Improve RLS policies to allow editing during grace period
-- Drop existing policies
DROP POLICY IF EXISTS \"Users can manage configs for their own licenses\" ON fanmark_basic_configs","DROP POLICY IF EXISTS \"Users can manage redirect configs for their own licenses\" ON fanmark_redirect_configs","DROP POLICY IF EXISTS \"Users can manage messageboard configs for their own licenses\" ON fanmark_messageboard_configs","-- Recreate policies with grace period support
CREATE POLICY \"Users can manage configs for their own licenses\"
ON fanmark_basic_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_basic_configs.license_id
      AND fl.user_id = auth.uid()
      AND (
        (fl.status = ''active'' AND fl.license_end > now())
        OR (fl.status = ''grace'' AND fl.excluded_at IS NULL)
      )
  )
)","CREATE POLICY \"Users can manage redirect configs for their own licenses\"
ON fanmark_redirect_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_redirect_configs.license_id
      AND fl.user_id = auth.uid()
      AND (
        (fl.status = ''active'' AND fl.license_end > now())
        OR (fl.status = ''grace'' AND fl.excluded_at IS NULL)
      )
  )
)","CREATE POLICY \"Users can manage messageboard configs for their own licenses\"
ON fanmark_messageboard_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_messageboard_configs.license_id
      AND fl.user_id = auth.uid()
      AND (
        (fl.status = ''active'' AND fl.license_end > now())
        OR (fl.status = ''grace'' AND fl.excluded_at IS NULL)
      )
  )
)"}', '9e3b277a-e473-46b9-9eac-aae1827fd0a8', NULL, NULL, NULL),
	('20250919175120', '{"-- Create user role enum
CREATE TYPE public.user_role AS ENUM (''user'', ''admin'')","-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (
    username ~ ''^[a-zA-Z0-9_]{3,20}$''
  ),
  display_name TEXT,
  bio TEXT CHECK (char_length(bio) <= 160),
  avatar_url TEXT,
  social_links JSONB DEFAULT ''{}'',
  is_public_profile BOOLEAN DEFAULT true,
  role user_role DEFAULT ''user'',
  emoji_limit INTEGER DEFAULT 10,
  subscription_status TEXT DEFAULT ''free'',
  subscription_end_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY","-- Create policies for profiles table
CREATE POLICY \"Public profiles are viewable by everyone\"
ON public.profiles
FOR SELECT
USING (is_public_profile = true)","CREATE POLICY \"Users can view their own profile\"
ON public.profiles
FOR SELECT
USING (auth.uid() = user_id)","CREATE POLICY \"Users can insert their own profile\"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id)","CREATE POLICY \"Users can update their own profile\"
ON public.profiles
FOR UPDATE
USING (auth.uid() = user_id)","-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public","-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    username,
    display_name
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data ->> ''display_name'', NEW.email)
  );
  RETURN NEW;
END;
$$","-- Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user()"}', '2ccd341c-6c12-428f-8fdc-55e604ec0581', NULL, NULL, NULL),
	('20250920081427', '{"-- Fix security definer view issue
-- Recreate the view without SECURITY DEFINER to respect user permissions
DROP VIEW IF EXISTS public.public_profiles","-- Create the view with default security (not SECURITY DEFINER)
-- This ensures it respects the querying user''s permissions
CREATE VIEW public.public_profiles AS
SELECT 
    p.id,
    p.username,
    p.display_name,
    p.bio,
    p.avatar_url,
    p.created_at
FROM public.profiles p
WHERE p.is_public_profile = true","-- Grant appropriate permissions
GRANT SELECT ON public.public_profiles TO authenticated","GRANT SELECT ON public.public_profiles TO anon"}', 'c80630e8-a345-4185-ab02-ec396fd5d9a7', NULL, NULL, NULL),
	('20250922144153', '{"-- Fix security vulnerability: Remove public access to emoji_profiles that exposes user_id
-- The current policy allows anyone to view emoji profiles including user_id when is_public = true

-- Drop the problematic public viewing policy
DROP POLICY IF EXISTS \"Users can view public emoji profiles\" ON public.emoji_profiles","-- Create a secure function to get public emoji profile data without exposing user_id
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(
  id uuid,
  fanmark_id uuid,
  bio text,
  social_links jsonb,
  theme_settings jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ep.id,
    ep.fanmark_id,
    ep.bio,
    ep.social_links,
    ep.theme_settings,
    ep.created_at,
    ep.updated_at
  FROM public.emoji_profiles ep
  WHERE ep.fanmark_id = profile_fanmark_id 
    AND ep.is_public = true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public","-- Create a new policy that only allows viewing public profiles via the secure function
-- This prevents direct access to the table that would expose user_id
CREATE POLICY \"Users can access emoji profiles through secure function only\" 
ON public.emoji_profiles 
FOR SELECT 
USING (
  -- Only allow access to own profiles or through the security definer function
  auth.uid() = user_id
)","-- Grant execute permission on the function to authenticated users
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO authenticated","GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon"}', 'e5dc7853-1329-45b0-af0d-6db7bdecb7fd', NULL, NULL, NULL),
	('20250924073454', '{"-- Rename fanmarks.display_name to fanmarks.fanmark_name for better clarity
ALTER TABLE public.fanmarks 
RENAME COLUMN display_name TO fanmark_name","-- Add comment to clarify the concept
COMMENT ON COLUMN public.fanmarks.fanmark_name IS ''ファンマーク自体の名前（内部管理用）''"}', '86f22c07-4593-4324-b4ae-adab5e3d649e', NULL, NULL, NULL),
	('20250924111612', '{"-- Fix remaining functions with search_path issues
CREATE OR REPLACE FUNCTION public.get_public_fanmark_profile(profile_fanmark_id uuid)
RETURNS TABLE(id uuid, fanmark_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
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
$$","CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(id uuid, fanmark_id uuid, user_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, is_public boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fp.id,
        fp.fanmark_id,
        fp.user_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.is_public,
        fp.created_at,
        fp.updated_at
    FROM fanmark_profiles fp
    WHERE fp.fanmark_id = profile_fanmark_id
    AND fp.is_public = true;
END;
$$","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.emoji_combination,
        COALESCE(bc.display_name, f.emoji_combination) as fanmark_name,
        f.access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active'';
END;
$$","CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, access_password text, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        f.access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.display_name as fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$$","CREATE OR REPLACE FUNCTION public.is_fanmark_licensed(fanmark_license_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses 
    WHERE id = fanmark_license_id 
      AND status = ''active''
      AND license_end > now()
  );
$$","CREATE OR REPLACE FUNCTION public.get_fanmark_ownership_status(fanmark_license_id uuid)
RETURNS TABLE(is_taken boolean, has_active_license boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
  SELECT 
    CASE WHEN fl.id IS NOT NULL THEN true ELSE false END as is_taken,
    CASE WHEN fl.status = ''active'' AND fl.license_end > now() THEN true ELSE false END as has_active_license
  FROM public.fanmark_licenses fl
  WHERE fl.id = fanmark_license_id
  LIMIT 1;
$$","CREATE OR REPLACE FUNCTION public.generate_safe_display_name(user_email text, user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Extract username part before @ from email, or use user_ + first 8 chars of UUID
  RETURN COALESCE(
    CASE 
      WHEN user_email IS NOT NULL AND user_email LIKE ''%@%'' THEN 
        split_part(user_email, ''@'', 1)
      ELSE 
        ''user_'' || substring(user_id::text, 1, 8)
    END,
    ''user_'' || substring(user_id::text, 1, 8)
  );
END;
$$","CREATE OR REPLACE FUNCTION public.notify_security_breach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Log critical security events
  IF NEW.action = ''UNAUTHORIZED_WAITLIST_ACCESS'' OR NEW.action = ''UNAUTHORIZED_EMAIL_ACCESS'' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE ''SECURITY ALERT: Unauthorized access attempt by user % at %'', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$$"}', '98a917d7-8f9c-4edc-a6ac-74ab489b93b4', NULL, NULL, NULL),
	('20250925034829', '{"-- Extend user_plan enum to include ''max'' plan
ALTER TYPE user_plan ADD VALUE ''max''","-- Add creator and max plan fanmark limits to system settings
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public) VALUES
(''creator_fanmarks_limit'', ''10'', ''Maximum fanmarks allowed for creator plan users'', true),
(''max_fanmarks_limit'', ''50'', ''Maximum fanmarks allowed for max plan users'', true)"}', '786c52f2-82ae-4064-8778-ff8089d10e98', NULL, NULL, NULL),
	('20251103131906', '{"-- Set the view to use security_invoker instead of security_definer
-- This ensures the view uses the querying user''s permissions rather than the creator''s
ALTER VIEW public.recent_active_fanmarks
SET (security_invoker = true)"}', '155cc27f-9e64-4b6b-95c4-211dd9a48986', NULL, NULL, NULL),
	('20250919182320', '{"-- Create a view for public profiles that excludes sensitive subscription data
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  user_id,
  username,
  display_name,
  bio,
  avatar_url,
  social_links,
  created_at
FROM public.profiles
WHERE is_public_profile = true","-- Enable RLS on the view
ALTER VIEW public.public_profiles SET (security_barrier = true)","-- Create RLS policy for the public profiles view
CREATE POLICY \"Public profiles view is accessible to everyone\"
ON public.profiles
FOR SELECT
USING (
  is_public_profile = true 
  AND (
    -- Only allow access to non-sensitive fields when accessed publicly
    current_setting(''row_security'', true) = ''on''
  )
)","-- Drop the existing overly permissive public policy
DROP POLICY IF EXISTS \"Public profiles are viewable by everyone\" ON public.profiles","-- Create a more restrictive policy for public access
CREATE POLICY \"Limited public profile access\"
ON public.profiles
FOR SELECT
USING (
  is_public_profile = true
  AND (
    -- Only authenticated users can see full profiles
    auth.uid() IS NOT NULL
    -- Or we''re accessing through the public view (this will be handled by application logic)
  )
)","-- Ensure users can still see their own full profiles
-- (This policy already exists but let''s make sure it''s there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = ''profiles'' 
    AND policyname = ''Users can view their own profile''
  ) THEN
    CREATE POLICY \"Users can view their own profile\"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$"}', 'a115d584-c6de-4493-ac90-93003b24aa66', NULL, NULL, NULL),
	('20250920082347', '{"-- Fix: Convert definer-style public view to invoker-safe cache-backed view, keep functionality intact
-- 1) Recreate view to read from cache (publicly selectable) and enable invoker rights
DROP VIEW IF EXISTS public.public_profiles","CREATE VIEW public.public_profiles AS
SELECT 
  id,
  username,
  display_name,
  bio,
  avatar_url,
  created_at
FROM public.public_profile_cache","-- Make sure the view evaluates RLS/permissions of the querying user
ALTER VIEW public.public_profiles SET (security_invoker = true, security_barrier = true)","-- 2) Ensure proper permissions
GRANT SELECT ON public.public_profiles TO anon","GRANT SELECT ON public.public_profiles TO authenticated","-- 3) Add triggers to keep cache in sync with profiles (function already exists)
DROP TRIGGER IF EXISTS trg_sync_public_profile_cache_insupd ON public.profiles","DROP TRIGGER IF EXISTS trg_sync_public_profile_cache_del ON public.profiles","CREATE TRIGGER trg_sync_public_profile_cache_insupd
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_public_profile_cache()","CREATE TRIGGER trg_sync_public_profile_cache_del
AFTER DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_public_profile_cache()","-- 4) Backfill cache for existing public profiles to avoid empty results
INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
SELECT p.id, p.username, p.display_name, p.bio, p.avatar_url, p.created_at
FROM public.profiles p
WHERE p.is_public_profile = true
ON CONFLICT (id) DO UPDATE
SET 
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  avatar_url = EXCLUDED.avatar_url,
  created_at = EXCLUDED.created_at"}', '27077021-b710-449d-9a86-592742d8bebc', NULL, NULL, NULL),
	('20250922144516', '{"-- Fix security linter issues

-- Issue 1: Add a policy for anon users to use the public function
-- This allows the public function to work for unauthenticated users
CREATE POLICY \"Allow public access to emoji profiles via function\" 
ON public.emoji_profiles 
FOR SELECT 
TO anon
USING (
  -- This policy specifically allows the security definer function to access public profiles
  -- The function itself controls the access logic
  is_public = true
)","-- Issue 2: Enable leaked password protection in auth settings
-- Note: This requires updating auth configuration, which we''ll document for the user"}', '38e7fc83-e091-40e8-b560-eb709bcf960c', NULL, NULL, NULL),
	('20250924073724', '{"-- Update get_fanmark_by_emoji function to return fanmark_name instead of display_name
DROP FUNCTION public.get_fanmark_by_emoji(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
  SELECT 
    f.emoji_combination,
    f.fanmark_name,
    f.access_type,
    f.target_url,
    f.text_content,
    f.status,
    f.is_password_protected,
    f.access_password
  FROM public.fanmarks f
  WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active''
  LIMIT 1;
$function$"}', '42b21b67-f5d6-42e2-b4e2-c074417502f2', NULL, NULL, NULL),
	('20250919182559', '{"-- Drop the problematic view and policies
DROP VIEW IF EXISTS public.public_profiles","DROP POLICY IF EXISTS \"Public profiles view is accessible to everyone\" ON public.profiles","DROP POLICY IF EXISTS \"Limited public profile access\" ON public.profiles","-- Create a simple view without security definer
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  user_id,
  username,
  display_name,
  bio,
  avatar_url,
  social_links,
  created_at
FROM public.profiles
WHERE is_public_profile = true","-- Create a more secure policy that restricts column access for anonymous users
-- This policy will only allow public access to non-sensitive fields
CREATE POLICY \"Public profiles with limited fields\"
ON public.profiles
FOR SELECT
USING (
  is_public_profile = true
  AND (
    -- Authenticated users can see all fields of public profiles
    auth.uid() IS NOT NULL
    -- Anonymous users should use the public_profiles view instead
    OR current_setting(''request.jwt.claims'', true)::json->>''role'' = ''anon''
  )
)"}', 'c0f0b34a-3332-49f1-919e-d0c3af2306ef', NULL, NULL, NULL),
	('20250920101442', '{"-- Create reserved emoji patterns table
CREATE TABLE public.reserved_emoji_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  price_yen INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Enable RLS on reserved emoji patterns
ALTER TABLE public.reserved_emoji_patterns ENABLE ROW LEVEL SECURITY","-- Allow anyone to view active reserved patterns
CREATE POLICY \"Anyone can view active reserved patterns\" 
ON public.reserved_emoji_patterns 
FOR SELECT 
USING (is_active = true)","-- Create audit logs table
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  metadata JSONB DEFAULT ''{}'',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Enable RLS on audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY","-- Users can only view their own audit logs
CREATE POLICY \"Users can view their own audit logs\" 
ON public.audit_logs 
FOR SELECT 
USING (auth.uid() = user_id)","-- Add trigger for updating reserved emoji patterns timestamps
CREATE TRIGGER update_reserved_emoji_patterns_updated_at
BEFORE UPDATE ON public.reserved_emoji_patterns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- Insert some sample reserved emoji patterns
INSERT INTO public.reserved_emoji_patterns (pattern, price_yen, description) VALUES
(''🏢'', 5000, ''Business building emoji - premium tier''),
(''💼'', 3000, ''Briefcase emoji - business tier''),
(''🏦'', 8000, ''Bank emoji - premium tier''),
(''🏪'', 2000, ''Store emoji - standard tier''),
(''🏭'', 4000, ''Factory emoji - business tier'')","-- Create indexes for performance
CREATE INDEX idx_reserved_emoji_patterns_pattern ON public.reserved_emoji_patterns(pattern)","CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id)","CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at)"}', '34fbf1a3-678c-4a78-8381-c7c1e07ad15f', NULL, NULL, NULL),
	('20250922144803', '{"-- Fix the remaining RLS policy issue for invitation_codes table
-- This table has RLS enabled but no policies, making it completely inaccessible

-- Add basic policies for invitation_codes table
-- Only admins should be able to manage invitation codes
CREATE POLICY \"Only admins can manage invitation codes\" 
ON public.invitation_codes 
FOR ALL 
USING (is_admin())
WITH CHECK (is_admin())","-- Allow authenticated users to validate codes (read-only for validation purposes)
CREATE POLICY \"Users can validate invitation codes\" 
ON public.invitation_codes 
FOR SELECT 
TO authenticated
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()))","-- Note: The leaked password protection warning needs to be fixed in Supabase auth settings
-- This requires manual configuration in the Supabase dashboard"}', '3a3f3eee-3b47-4619-b0bb-c1d06096020f', NULL, NULL, NULL),
	('20250924074240', '{"-- Ensure unique (fanmark_id, user_id) for emoji_profiles and clean duplicates
BEGIN","-- 1) Remove duplicate rows, keeping the most recently updated per (fanmark_id, user_id)
WITH ranked AS (
  SELECT 
    id,
    fanmark_id,
    user_id,
    ROW_NUMBER() OVER (
      PARTITION BY fanmark_id, user_id 
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.emoji_profiles
)
DELETE FROM public.emoji_profiles ep
USING ranked r
WHERE ep.id = r.id
  AND r.rn > 1","-- 2) Add unique constraint to support ON CONFLICT upserts
ALTER TABLE public.emoji_profiles
ADD CONSTRAINT emoji_profiles_fanmark_user_unique UNIQUE (fanmark_id, user_id)",COMMIT}', '1339c53a-4a5b-46c5-ac9d-7aaab2c303ae', NULL, NULL, NULL),
	('20251019153644', '{"-- Add invited_by_code column to user_settings table
ALTER TABLE public.user_settings 
ADD COLUMN invited_by_code TEXT 
REFERENCES public.invitation_codes(code)","-- Create index for performance
CREATE INDEX idx_user_settings_invited_by_code 
ON public.user_settings(invited_by_code) 
WHERE invited_by_code IS NOT NULL","-- Add comment for documentation
COMMENT ON COLUMN public.user_settings.invited_by_code IS ''Invitation code used during signup''"}', 'ca51c1e0-d1c4-4e24-a519-d44f76dd75e2', NULL, NULL, NULL),
	('20250919182812', '{"-- Drop the view completely and implement a policy-based solution
DROP VIEW IF EXISTS public.public_profiles","-- Drop existing problematic policy
DROP POLICY IF EXISTS \"Public profiles with limited fields\" ON public.profiles","-- Re-create the original policy but with a more restrictive approach
-- We''ll handle the column filtering at the application level instead of database level
CREATE POLICY \"Public profiles viewable by everyone\"
ON public.profiles
FOR SELECT
USING (is_public_profile = true)","-- Add a comment to document the security consideration
COMMENT ON POLICY \"Public profiles viewable by everyone\" ON public.profiles IS 
''This policy allows public access to profiles marked as public. Application code must filter sensitive fields like subscription data when serving to anonymous users.''"}', '8ce93376-3e91-47c1-819f-9c6847a3d83d', NULL, NULL, NULL),
	('20250920110851', '{"-- Add secure admin-only SELECT policy for waitlist table
-- This ensures that only authenticated users with admin role can view waitlist data
-- preventing email harvesting while allowing legitimate admin access

-- First, create a security definer function to check admin role safely
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if the current user has admin role in profiles table
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() 
    AND role = ''admin''
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","-- Add admin-only SELECT policy for waitlist
CREATE POLICY \"Only admins can view waitlist data\"
ON public.waitlist
FOR SELECT
USING (public.is_admin())","-- Add audit logging for waitlist access (security monitoring)
CREATE OR REPLACE FUNCTION public.log_waitlist_access()
RETURNS TRIGGER AS $$
BEGIN
  -- Log all SELECT operations on waitlist for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    ''SELECT'',
    ''waitlist'',
    NEW.id::text,
    json_build_object(
      ''table'', ''waitlist'',
      ''access_time'', now(),
      ''user_role'', (SELECT role FROM public.profiles WHERE user_id = auth.uid())
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public","-- Create trigger for audit logging (only fires on SELECT via function)
-- Note: We''ll track this in application code since triggers don''t fire on SELECT"}', 'e793caf1-d19c-4811-865d-4e12eb240e1e', NULL, NULL, NULL),
	('20250922145543', '{"-- CRITICAL SECURITY FIX: Remove the remaining public access policy that exposes user_id
-- The policy \"Allow public access to emoji profiles via function\" still allows direct table access

-- Drop the problematic policy that allows public access to the table
DROP POLICY IF EXISTS \"Allow public access to emoji profiles via function\" ON public.emoji_profiles","-- The secure access should ONLY happen through the security definer function
-- The existing policy \"Users can access emoji profiles through secure function only\" 
-- already allows authenticated users to see their own profiles

-- Update the security definer function to be accessible by anon users for public profiles
-- This ensures public access only goes through the controlled function, never direct table access
REVOKE ALL ON public.emoji_profiles FROM anon","REVOKE ALL ON public.emoji_profiles FROM authenticated","-- Grant only what''s needed for the security definer function to work
GRANT USAGE ON SCHEMA public TO anon","GRANT USAGE ON SCHEMA public TO authenticated","-- Ensure the function can still be called but table access is completely controlled
-- The security definer function will handle all public access securely"}', '8f9e0f60-f010-4085-944b-ccb7f45834c3', NULL, NULL, NULL),
	('20251019215023', '{"-- Phase 1: Notification System Database Schema
-- Create core notification tables with RLS policies

-- ================================================================
-- 1. notification_events table
-- ================================================================
CREATE TABLE public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK (source IN (''batch'', ''edge_function'', ''admin_ui'')),
  payload JSONB NOT NULL DEFAULT ''{}''::jsonb,
  payload_schema TEXT,
  trigger_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''processed'', ''error'', ''skipped'')),
  processed_at TIMESTAMPTZ,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_event_dedupe UNIQUE(event_type, dedupe_key)
)","-- Indexes for notification_events
CREATE INDEX idx_notification_events_status_trigger 
ON public.notification_events(status, trigger_at)
WHERE status = ''pending''","CREATE INDEX idx_notification_events_event_type 
ON public.notification_events(event_type)","-- RLS for notification_events
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY","CREATE POLICY \"Admins can view notification events\"
ON public.notification_events FOR SELECT
USING (public.is_admin())","CREATE POLICY \"System can manage notification events\"
ON public.notification_events FOR ALL
USING (auth.role() = ''service_role'')","-- ================================================================
-- 2. notification_templates table
-- ================================================================
CREATE TABLE public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL CHECK (channel IN (''in_app'', ''email'', ''webpush'')),
  language TEXT NOT NULL DEFAULT ''ja'',
  title TEXT,
  body TEXT NOT NULL,
  summary TEXT,
  payload_schema JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_template_version UNIQUE(template_id, version, channel, language)
)","-- RLS for notification_templates
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY","CREATE POLICY \"Admins can manage templates\"
ON public.notification_templates FOR ALL
USING (public.is_admin())","CREATE POLICY \"Authenticated users can view active templates\"
ON public.notification_templates FOR SELECT
USING (is_active = true AND auth.uid() IS NOT NULL)","-- ================================================================
-- 3. notification_rules table
-- ================================================================
CREATE TABLE public.notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN (''in_app'', ''email'', ''webpush'')),
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
)","-- Index for notification_rules
CREATE INDEX idx_notification_rules_event_type 
ON public.notification_rules(event_type)
WHERE enabled = true","-- RLS for notification_rules
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY","CREATE POLICY \"Admins can manage notification rules\"
ON public.notification_rules FOR ALL
USING (public.is_admin())","-- ================================================================
-- 4. notifications table
-- ================================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.notification_events(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN (''in_app'', ''email'', ''webpush'')),
  template_id UUID NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT ''{}''::jsonb,
  status TEXT NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'', ''sending'', ''sent'', ''failed'', ''cancelled'')),
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
)","-- Indexes for notifications
CREATE INDEX idx_notifications_user_unread 
ON public.notifications(user_id, read_at)
WHERE read_at IS NULL AND channel = ''in_app''","CREATE INDEX idx_notifications_status_channel 
ON public.notifications(status, channel)
WHERE status IN (''pending'', ''failed'')","CREATE INDEX idx_notifications_user_created 
ON public.notifications(user_id, created_at DESC)","-- RLS for notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY","CREATE POLICY \"Users can view their own notifications\"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id)","CREATE POLICY \"Users can update their own notifications\"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id)","CREATE POLICY \"System can manage all notifications\"
ON public.notifications FOR ALL
USING (auth.role() = ''service_role'')","-- ================================================================
-- 5. notification_preferences table (future expansion)
-- ================================================================
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN (''in_app'', ''email'', ''webpush'')),
  event_type TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_user_channel_event UNIQUE(user_id, channel, event_type)
)","-- RLS for notification_preferences
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY","CREATE POLICY \"Users can manage their own preferences\"
ON public.notification_preferences FOR ALL
USING (auth.uid() = user_id)","-- ================================================================
-- 6. notifications_history table (archive)
-- ================================================================
CREATE TABLE public.notifications_history (
  id UUID PRIMARY KEY,
  original_data JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
)","-- RLS for notifications_history
ALTER TABLE public.notifications_history ENABLE ROW LEVEL SECURITY","CREATE POLICY \"Admins can view notification history\"
ON public.notifications_history FOR SELECT
USING (public.is_admin())","-- ================================================================
-- 7. Triggers for updated_at
-- ================================================================
CREATE TRIGGER update_notification_events_updated_at
BEFORE UPDATE ON public.notification_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_notification_templates_updated_at
BEFORE UPDATE ON public.notification_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_notification_rules_updated_at
BEFORE UPDATE ON public.notification_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_notifications_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- ================================================================
-- 8. Comments for documentation
-- ================================================================
COMMENT ON TABLE public.notification_events IS ''Stores notification trigger events with deduplication''","COMMENT ON TABLE public.notification_rules IS ''Defines notification delivery rules per event type''","COMMENT ON TABLE public.notifications IS ''Actual notification records delivered to users''","COMMENT ON TABLE public.notification_templates IS ''Notification message templates with versioning''","COMMENT ON TABLE public.notification_preferences IS ''User notification preferences (future expansion)''","COMMENT ON TABLE public.notifications_history IS ''Archived notifications for compliance''"}', '01c64f21-44b9-4dde-9ed8-33166c337052', NULL, NULL, NULL),
	('20251107000250', '{"-- Make fanmark_licenses.user_id nullable to allow historical data retention after user deletion
-- This resolves the design contradiction between NOT NULL constraint and ON DELETE SET NULL foreign key

ALTER TABLE fanmark_licenses 
ALTER COLUMN user_id DROP NOT NULL","-- Add comment for clarity
COMMENT ON COLUMN fanmark_licenses.user_id IS 
''User who owns/owned this license. NULL indicates the user account has been deleted but license history is retained for audit purposes.''"}', 'a6a974a7-057c-4532-8248-35d686f6b29f', NULL, NULL, NULL),
	('20250920001047', '{"-- Fix subscription data exposure by creating secure RLS policy for public profiles
-- This policy only exposes safe, non-sensitive fields to the public

-- Drop the existing public profile policy
DROP POLICY IF EXISTS \"Public profiles viewable by everyone\" ON public.profiles","-- Create a new secure policy that excludes sensitive subscription data
CREATE POLICY \"Public profiles viewable by everyone\" ON public.profiles
FOR SELECT USING (
  is_public_profile = true
  AND CASE 
    WHEN auth.uid() = user_id THEN true  -- Users can see their own full profile
    ELSE false  -- Public users see no subscription data through this policy
  END
)","-- Create a separate policy for public viewing of safe fields only
CREATE POLICY \"Safe public profile data viewable by everyone\" ON public.profiles
FOR SELECT USING (
  is_public_profile = true
  -- This policy will be used with specific column selection in application code
  -- to ensure only safe fields (username, display_name, bio, avatar_url, social_links) are exposed
)"}', 'afeb4dc9-3165-4c0f-8062-38a8a2fd0608', NULL, NULL, NULL),
	('20250920124138', '{"-- Create fanmark availability rules table for pattern-based pricing
CREATE TABLE public.fanmark_availability_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (rule_type IN (''specific_pattern'', ''duplicate_pattern'', ''prefix_pattern'', ''count_based'')),
  priority INTEGER NOT NULL CHECK (priority >= 1 AND priority <= 4),
  rule_config JSONB NOT NULL DEFAULT ''{}''::jsonb,
  is_available BOOLEAN NOT NULL DEFAULT true,
  price_usd DECIMAL(10,2),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
)","-- Enable RLS
ALTER TABLE public.fanmark_availability_rules ENABLE ROW LEVEL SECURITY","-- Create policies
CREATE POLICY \"Anyone can view active availability rules\" 
ON public.fanmark_availability_rules 
FOR SELECT 
USING (is_available = true)","CREATE POLICY \"Only admins can manage availability rules\" 
ON public.fanmark_availability_rules 
FOR ALL 
USING (is_admin())","-- Create index for performance
CREATE INDEX idx_fanmark_availability_rules_type_priority ON public.fanmark_availability_rules(rule_type, priority)","CREATE INDEX idx_fanmark_availability_rules_available ON public.fanmark_availability_rules(is_available) WHERE is_available = true","-- Create trigger for updated_at
CREATE TRIGGER update_fanmark_availability_rules_updated_at
BEFORE UPDATE ON public.fanmark_availability_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- Insert default rules
INSERT INTO public.fanmark_availability_rules (rule_type, priority, rule_config, price_usd, description) VALUES
(''specific_pattern'', 1, ''{\"patterns\": [\"🎄\", \"🏢\", \"💎\"]}'', 99.99, ''Specific reserved patterns''),
(''duplicate_pattern'', 2, ''{\"enabled\": true}'', 19.99, ''Consecutive duplicate emojis''),
(''prefix_pattern'', 3, ''{\"prefixes\": {\"🎄\": 5.99, \"🏢\": 29.99, \"💎\": 19.99}}'', null, ''Prefix-based pricing''),
(''count_based'', 4, ''{\"pricing\": {\"1\": 0.99, \"2\": 4.99, \"3\": 9.99, \"4\": 19.99, \"5\": 39.99}}'', null, ''Count-based default pricing'')"}', 'e1e21e67-eb41-4331-bdb2-6debbf9df288', NULL, NULL, NULL),
	('20250922145726', '{"-- Restore necessary permissions for authenticated users to manage their own emoji profiles
-- while keeping public access completely locked down

-- Grant SELECT, INSERT, UPDATE permissions to authenticated users only for RLS policies to work
GRANT SELECT, INSERT, UPDATE ON public.emoji_profiles TO authenticated","-- Verify that only authenticated users can access their own profiles
-- No public/anon access to the table directly - only through the security definer function"}', '546c5f17-37ad-42bb-a94f-f92a5495612a', NULL, NULL, NULL),
	('20250925123518', '{"-- Security Fix: Restrict public access to fanmark_profiles table
-- Remove overly permissive public access policy and create secure public view

-- Drop the existing overly permissive public access policy
DROP POLICY IF EXISTS \"Public can view public fanmark profiles\" ON public.fanmark_profiles","-- Create a secure view for public profile access that excludes sensitive data
CREATE OR REPLACE VIEW public.public_fanmark_profiles AS
SELECT 
  fp.fanmark_id,
  fp.display_name,
  fp.bio,
  fp.social_links,
  fp.theme_settings,
  fp.created_at,
  fp.updated_at
FROM public.fanmark_profiles fp
WHERE fp.is_public = true","-- Grant public read access to the secure view only
GRANT SELECT ON public.public_fanmark_profiles TO anon, authenticated","-- Create a more restrictive RLS policy for the main table
CREATE POLICY \"Users can view their own fanmark profiles\" 
ON public.fanmark_profiles 
FOR SELECT 
USING (auth.uid() = user_id)","CREATE POLICY \"Users can create their own fanmark profiles\" 
ON public.fanmark_profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id)","CREATE POLICY \"Users can update their own fanmark profiles\" 
ON public.fanmark_profiles 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)","CREATE POLICY \"Users can delete their own fanmark profiles\" 
ON public.fanmark_profiles 
FOR DELETE 
USING (auth.uid() = user_id)","-- Drop the existing function first to avoid signature conflicts
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid)","-- Create the updated secure function that excludes user_id and id
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(
  fanmark_id uuid, 
  display_name text, 
  bio text, 
  social_links jsonb, 
  theme_settings jsonb, 
  created_at timestamp with time zone, 
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ppf.fanmark_id,
    ppf.display_name,
    ppf.bio,
    ppf.social_links,
    ppf.theme_settings,
    ppf.created_at,
    ppf.updated_at
  FROM public.public_fanmark_profiles ppf
  WHERE ppf.fanmark_id = profile_fanmark_id
  ORDER BY ppf.updated_at DESC
  LIMIT 1;
$$"}', 'b6f74600-8fe4-495b-8614-16705989b6ee', NULL, NULL, NULL),
	('20250920021413', '{"-- Security Fix: Prevent email exposure in public profiles

-- Step 1: Create a function to generate safe display names
CREATE OR REPLACE FUNCTION public.generate_safe_display_name(user_email TEXT, user_id UUID)
RETURNS TEXT AS $$
BEGIN
  -- Extract username part before @ from email, or use user_ + first 8 chars of UUID
  RETURN COALESCE(
    CASE 
      WHEN user_email IS NOT NULL AND user_email LIKE ''%@%'' THEN 
        split_part(user_email, ''@'', 1)
      ELSE 
        ''user_'' || substring(user_id::text, 1, 8)
    END,
    ''user_'' || substring(user_id::text, 1, 8)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","-- Step 2: Update existing profiles that have email addresses as display names
UPDATE public.profiles 
SET display_name = public.generate_safe_display_name(display_name, user_id)
WHERE display_name LIKE ''%@%.%'' AND display_name LIKE ''%@%''","-- Step 3: Update the handle_new_user function to use safe display names
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    username,
    display_name
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> ''display_name'',
      public.generate_safe_display_name(NEW.email, NEW.id)
    )
  );
  RETURN NEW;
END;
$$","-- Step 4: Fix conflicting RLS policies by dropping conflicting ones and creating a clear policy
DROP POLICY IF EXISTS \"Public profiles viewable by everyone\" ON public.profiles","DROP POLICY IF EXISTS \"Safe public profile data viewable by everyone\" ON public.profiles","-- Create a single, clear policy for public profile access
CREATE POLICY \"Public profiles are viewable by everyone\" 
ON public.profiles 
FOR SELECT 
USING (
  -- Users can always see their own profile
  auth.uid() = user_id 
  OR 
  -- Public profiles are viewable by anyone
  (is_public_profile = true)
)","-- Step 5: Add a trigger to prevent email addresses from being set as display names
CREATE OR REPLACE FUNCTION public.validate_display_name()
RETURNS trigger AS $$
BEGIN
  -- Check if display_name looks like an email address
  IF NEW.display_name IS NOT NULL AND NEW.display_name LIKE ''%@%.%'' THEN
    -- Replace with safe display name
    NEW.display_name = public.generate_safe_display_name(NEW.display_name, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public","-- Create trigger to validate display names on insert and update
DROP TRIGGER IF EXISTS validate_display_name_trigger ON public.profiles","CREATE TRIGGER validate_display_name_trigger
  BEFORE INSERT OR UPDATE OF display_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_display_name()"}', 'b52fb9db-5816-4ba6-a531-414e65102638', NULL, NULL, NULL),
	('20250920131821', '{"-- Insert a sample invitation code for testing
INSERT INTO invitation_codes (
  code,
  is_active,
  max_uses,
  used_count,
  special_perks,
  expires_at
) VALUES (
  ''WELCOME2025'',
  true,
  100,
  0,
  ''{\"premium_trial\": true, \"bonus_emojis\": 5}'',
  NOW() + INTERVAL ''30 days''
)","-- Enable invitation mode
INSERT INTO system_settings (setting_key, setting_value, is_public, description)
VALUES (''invitation_mode'', ''true'', true, ''Controls whether invitation codes are required for registration'')
ON CONFLICT (setting_key) 
DO UPDATE SET 
  setting_value = ''true'',
  updated_at = NOW()"}', '14379663-b820-4d73-be56-265f8ffa2160', NULL, NULL, NULL),
	('20250922150536', '{"-- Fix emoji_profiles table permissions for authenticated users
-- Ensure authenticated users have all necessary permissions for their own profiles

-- Grant all necessary permissions to authenticated users for emoji_profiles table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emoji_profiles TO authenticated","-- Verify that the functions can still be called by anonymous users for public access
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO authenticated","GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon"}', 'd4da4fc0-70b1-4f5a-b5c0-c966952a648d', NULL, NULL, NULL),
	('20250924092756', '{"-- Clean up duplicate emoji_profiles records, keeping only the latest one
WITH duplicate_profiles AS (
  SELECT 
    fanmark_id,
    user_id,
    ROW_NUMBER() OVER (PARTITION BY fanmark_id, user_id ORDER BY updated_at DESC) as rn
  FROM emoji_profiles
),
profiles_to_delete AS (
  SELECT ep.id
  FROM emoji_profiles ep
  JOIN duplicate_profiles dp ON ep.fanmark_id = dp.fanmark_id AND ep.user_id = dp.user_id
  WHERE dp.rn > 1
)
DELETE FROM emoji_profiles 
WHERE id IN (SELECT id FROM profiles_to_delete)","-- Update the get_public_emoji_profile function to always return the most recent record
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
 RETURNS TABLE(id uuid, fanmark_id uuid, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ep.id,
    ep.fanmark_id,
    ep.bio,
    ep.social_links,
    ep.theme_settings,
    ep.created_at,
    ep.updated_at
  FROM public.emoji_profiles ep
  WHERE ep.fanmark_id = profile_fanmark_id 
    AND ep.is_public = true
  ORDER BY ep.updated_at DESC
  LIMIT 1;
END;
$function$"}', 'f4a82549-bb92-4626-96b1-3b651adbbc44', NULL, NULL, NULL),
	('20250924120827', '{"-- Rename display_name to fanmark_name in fanmark_basic_configs table
ALTER TABLE public.fanmark_basic_configs 
RENAME COLUMN display_name TO fanmark_name","-- Update get_fanmark_by_emoji function to use new column name
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        f.access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active'';
END;
$function$","-- Update get_fanmark_complete_data function to use new column name
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, access_password text, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        f.access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$"}', '60ebe83e-2c28-4482-a01a-1176136968cd', NULL, NULL, NULL),
	('20251019230425', '{"-- Database functions for notification system (fixed)

-- Function to render notification template
CREATE OR REPLACE FUNCTION public.render_notification_template(
  template_id_param uuid,
  template_version_param integer,
  payload_param jsonb,
  language_param text DEFAULT ''ja''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
BEGIN
  -- Fetch template
  SELECT title, body, summary
  INTO template_record
  FROM public.notification_templates
  WHERE template_id = template_id_param
    AND version = template_version_param
    AND language = language_param
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Template not found: % version % language %'', 
      template_id_param, template_version_param, language_param;
  END IF;

  -- Simple template rendering (replace {{key}} with payload values)
  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  -- Replace placeholders with payload values
  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    rendered_title := REPLACE(rendered_title, ''{{'' || key_name || ''}}'', payload_param->>key_name);
    rendered_body := REPLACE(rendered_body, ''{{'' || key_name || ''}}'', payload_param->>key_name);
    IF rendered_summary IS NOT NULL THEN
      rendered_summary := REPLACE(rendered_summary, ''{{'' || key_name || ''}}'', payload_param->>key_name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    ''title'', rendered_title,
    ''body'', rendered_body,
    ''summary'', rendered_summary
  );
END;
$$","-- Function to create notification event
CREATE OR REPLACE FUNCTION public.create_notification_event(
  event_type_param text,
  payload_param jsonb,
  source_param text DEFAULT ''system'',
  dedupe_key_param text DEFAULT NULL,
  trigger_at_param timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id uuid;
BEGIN
  -- Check for duplicate if dedupe_key is provided
  IF dedupe_key_param IS NOT NULL THEN
    SELECT id INTO event_id
    FROM public.notification_events
    WHERE dedupe_key = dedupe_key_param
      AND status IN (''pending'', ''processing'')
    LIMIT 1;

    IF FOUND THEN
      RAISE NOTICE ''Duplicate event found with dedupe_key: %'', dedupe_key_param;
      RETURN event_id;
    END IF;
  END IF;

  -- Insert new event
  INSERT INTO public.notification_events (
    event_type,
    payload,
    source,
    dedupe_key,
    trigger_at,
    status
  )
  VALUES (
    event_type_param,
    payload_param,
    source_param,
    dedupe_key_param,
    trigger_at_param,
    ''pending''
  )
  RETURNING id INTO event_id;

  RETURN event_id;
END;
$$","-- Function to mark notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  notification_id_param uuid,
  read_via_param text DEFAULT ''app''
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION ''Authentication required'';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE id = notification_id_param
    AND user_id = current_user_id
    AND read_at IS NULL;

  RETURN FOUND;
END;
$$","-- Function to get unread notification count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
  user_id_param uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  unread_count integer;
BEGIN
  current_user_id := COALESCE(user_id_param, auth.uid());

  IF current_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer INTO unread_count
  FROM public.notifications
  WHERE user_id = current_user_id
    AND read_at IS NULL
    AND status = ''delivered''
    AND (expires_at IS NULL OR expires_at > now());

  RETURN unread_count;
END;
$$","-- Function to archive old notifications
CREATE OR REPLACE FUNCTION public.archive_old_notifications(
  days_old integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
  cutoff_date timestamptz;
BEGIN
  cutoff_date := now() - (days_old || '' days'')::interval;

  -- Move to history table
  WITH archived AS (
    DELETE FROM public.notifications
    WHERE created_at < cutoff_date
      AND status IN (''delivered'', ''failed'')
    RETURNING id, jsonb_build_object(
      ''id'', id,
      ''user_id'', user_id,
      ''event_id'', event_id,
      ''rule_id'', rule_id,
      ''template_id'', template_id,
      ''template_version'', template_version,
      ''channel'', channel,
      ''status'', status,
      ''payload'', payload,
      ''priority'', priority,
      ''triggered_at'', triggered_at,
      ''delivered_at'', delivered_at,
      ''read_at'', read_at,
      ''read_via'', read_via,
      ''expires_at'', expires_at,
      ''retry_count'', retry_count,
      ''error_reason'', error_reason,
      ''created_at'', created_at,
      ''updated_at'', updated_at
    ) as original_data
  )
  INSERT INTO public.notifications_history (id, original_data)
  SELECT id, original_data FROM archived;

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  RETURN archived_count;
END;
$$"}', 'fefccfe1-2c9b-459e-99cd-a055d23ec4aa', NULL, NULL, NULL),
	('20251126002551', '{"-- Migrate fanmark_tier_extension_prices to single stripe_price_id column
-- Add new column
ALTER TABLE fanmark_tier_extension_prices
ADD COLUMN stripe_price_id text","-- Migrate existing test price IDs to the new column
UPDATE fanmark_tier_extension_prices
SET stripe_price_id = stripe_price_id_test
WHERE stripe_price_id_test IS NOT NULL","-- Drop old columns
ALTER TABLE fanmark_tier_extension_prices
DROP COLUMN stripe_price_id_test,
DROP COLUMN stripe_price_id_live"}', '131c10a6-85fa-44bc-a112-689ff11c12a9', NULL, NULL, NULL),
	('20250920022245', '{"-- Fix the remaining RLS policy conflict
-- Drop all SELECT policies and create one comprehensive policy

DROP POLICY IF EXISTS \"Users can view their own profile\" ON public.profiles","DROP POLICY IF EXISTS \"Public profiles are viewable by everyone\" ON public.profiles","-- Create a single, comprehensive SELECT policy
CREATE POLICY \"Profile access policy\" 
ON public.profiles 
FOR SELECT 
USING (
  -- Users can always view their own profile
  auth.uid() = user_id 
  OR 
  -- Anyone can view public profiles
  is_public_profile = true
)"}', 'ce4705f8-464d-477f-82c7-38ff940b7783', NULL, NULL, NULL),
	('20250920204549', '{"-- Create storage bucket for avatars
INSERT INTO storage.buckets (id, name, public) VALUES (''avatars'', ''avatars'', true)","-- Create policies for avatar uploads
CREATE POLICY \"Avatar images are publicly accessible\" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = ''avatars'')","CREATE POLICY \"Users can upload their own avatar\" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = ''avatars'' AND auth.uid()::text = (storage.foldername(name))[1])","CREATE POLICY \"Users can update their own avatar\" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = ''avatars'' AND auth.uid()::text = (storage.foldername(name))[1])","CREATE POLICY \"Users can delete their own avatar\" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = ''avatars'' AND auth.uid()::text = (storage.foldername(name))[1])"}', 'c7f7e0dd-2053-4fda-80d2-4f1ce133d392', NULL, NULL, NULL),
	('20250922151101', '{"-- CRITICAL SECURITY FIX: Enhance waitlist security and admin authentication
-- Address multiple security concerns with waitlist access and admin verification

-- 1. Create enhanced admin authentication with additional security checks
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  user_profile RECORD;
  session_valid BOOLEAN := false;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Get user profile with role information
  SELECT * INTO user_profile 
  FROM public.profiles 
  WHERE user_id = auth.uid() 
  AND role = ''admin'';

  -- If no admin profile found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Additional security check: verify session is recent (within last 4 hours)
  -- This prevents stale admin sessions from being used
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions 
    WHERE user_id = auth.uid() 
    AND created_at > NOW() - INTERVAL ''4 hours''
    AND NOT (aal IS NULL OR aal = '''')
  ) INTO session_valid;

  -- Log admin access attempt for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    ''ADMIN_CHECK'',
    ''system'',
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''ip_address'', COALESCE(current_setting(''request.headers'', true)::json->>''x-forwarded-for'', ''unknown''),
      ''user_agent'', COALESCE(current_setting(''request.headers'', true)::json->>''user-agent'', ''unknown''),
      ''session_valid'', session_valid,
      ''admin_check_result'', session_valid
    )
  );

  RETURN session_valid;
END;
$$","-- 2. Create function for secure waitlist access with comprehensive logging
CREATE OR REPLACE FUNCTION public.get_waitlist_secure(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  email_hash TEXT,  -- Return hash instead of actual email
  referral_source TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Verify admin access with enhanced security
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_WAITLIST_ACCESS'',
      ''waitlist'',
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''ip_address'', COALESCE(current_setting(''request.headers'', true)::json->>''x-forwarded-for'', ''unknown''),
        ''attempted_action'', ''get_waitlist_secure'',
        ''security_level'', ''HIGH_RISK''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to waitlist data'';
  END IF;

  -- Log authorized admin access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    ''AUTHORIZED_WAITLIST_ACCESS'',
    ''waitlist'',
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''record_count'', (SELECT COUNT(*) FROM public.waitlist),
      ''limit'', p_limit,
      ''offset'', p_offset,
      ''security_level'', ''ADMIN_VERIFIED''
    )
  );

  -- Return waitlist data with email hashed for additional security
  RETURN QUERY
  SELECT 
    w.id,
    encode(digest(w.email, ''sha256''), ''hex'') as email_hash,  -- Hash email for privacy
    w.referral_source,
    w.status,
    w.created_at
  FROM public.waitlist w
  ORDER BY w.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$","-- 3. Create function to get actual email (for legitimate admin use only)
CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_EMAIL_ACCESS'',
      ''waitlist'',
      waitlist_id::text,
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''security_level'', ''CRITICAL_RISK'',
        ''attempted_resource'', ''email_address''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to email data'';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    ''EMAIL_ACCESS'',
    ''waitlist'',
    waitlist_id::text,
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''security_level'', ''ADMIN_VERIFIED'',
      ''purpose'', ''email_retrieval''
    )
  );

  RETURN email_result;
END;
$$","-- 4. Update waitlist policies with enhanced security
DROP POLICY IF EXISTS \"Only admins can view waitlist data\" ON public.waitlist","-- New restrictive policy - no direct table access
CREATE POLICY \"Waitlist access only through secure functions\" 
ON public.waitlist 
FOR SELECT 
USING (false)","-- Block all direct access

-- Keep insert policy for user registration
-- The existing \"Anyone can join waitlist\" policy is fine for INSERT

-- 5. Grant execute permissions only to authenticated users
GRANT EXECUTE ON FUNCTION public.get_waitlist_secure(INTEGER, INTEGER) TO authenticated","GRANT EXECUTE ON FUNCTION public.get_waitlist_email_by_id(UUID) TO authenticated","GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated","-- 6. Create notification function for security alerts
CREATE OR REPLACE FUNCTION public.notify_security_breach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log critical security events
  IF NEW.action = ''UNAUTHORIZED_WAITLIST_ACCESS'' OR NEW.action = ''UNAUTHORIZED_EMAIL_ACCESS'' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE ''SECURITY ALERT: Unauthorized access attempt by user % at %'', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$$","-- 7. Create trigger for security monitoring
DROP TRIGGER IF EXISTS security_alert_trigger ON public.audit_logs","CREATE TRIGGER security_alert_trigger
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_security_breach()"}', 'bdb46699-e8c0-48ed-be2b-954feda14879', NULL, NULL, NULL),
	('20250924102417', '{"-- PHASE 1: Clear existing data and restructure tables (Final version)

-- Clear existing data
DELETE FROM emoji_profiles","DELETE FROM fanmarks","DELETE FROM fanmark_licenses","-- Drop existing emoji_profiles table
DROP TABLE IF EXISTS emoji_profiles CASCADE","-- Drop existing function that references emoji_profiles
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid)","-- Drop views that depend on fanmarks columns
DROP VIEW IF EXISTS public.fanmark_search_auth_v1","DROP VIEW IF EXISTS public.fanmark_search_public_v1","DROP VIEW IF EXISTS public.my_fanmark_claims_v1","-- Drop existing RLS policies on fanmarks that depend on user_id
DROP POLICY IF EXISTS \"Users can create their own fanmarks\" ON public.fanmarks","DROP POLICY IF EXISTS \"Users can update their own fanmarks\" ON public.fanmarks","DROP POLICY IF EXISTS \"Users can view their own fanmarks\" ON public.fanmarks","DROP POLICY IF EXISTS \"authenticated_search_fanmarks_limited\" ON public.fanmarks","DROP POLICY IF EXISTS \"anonymous_no_direct_access\" ON public.fanmarks","-- Now safely remove columns from fanmarks table
ALTER TABLE fanmarks 
DROP COLUMN IF EXISTS user_id CASCADE,
DROP COLUMN IF EXISTS tier_level CASCADE,
DROP COLUMN IF EXISTS current_license_id CASCADE,
DROP COLUMN IF EXISTS is_transferable CASCADE,
DROP COLUMN IF EXISTS is_password_protected CASCADE,
DROP COLUMN IF EXISTS access_password CASCADE,
DROP COLUMN IF EXISTS fanmark_name CASCADE,
DROP COLUMN IF EXISTS target_url CASCADE,
DROP COLUMN IF EXISTS text_content CASCADE","-- Simplify fanmark_licenses table
ALTER TABLE fanmark_licenses 
DROP COLUMN IF EXISTS tier_level CASCADE","-- Create new simplified RLS policies for fanmarks table
CREATE POLICY \"Fanmarks are accessible to authenticated users\" 
ON public.fanmarks 
FOR SELECT 
USING (auth.uid() IS NOT NULL)","-- Create new fanmark_profiles table (renamed from emoji_profiles)
CREATE TABLE public.fanmark_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL,
  user_id UUID NOT NULL,
  display_name TEXT,
  bio TEXT,
  social_links JSONB DEFAULT ''{}''::jsonb,
  theme_settings JSONB DEFAULT ''{}''::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_basic_configs table
CREATE TABLE public.fanmark_basic_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_redirect_configs table
CREATE TABLE public.fanmark_redirect_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_messageboard_configs table
CREATE TABLE public.fanmark_messageboard_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_password_configs table
CREATE TABLE public.fanmark_password_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  access_password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Enable RLS on new tables
ALTER TABLE public.fanmark_profiles ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_basic_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_redirect_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_messageboard_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_password_configs ENABLE ROW LEVEL SECURITY","-- Create RLS policies for fanmark_profiles
CREATE POLICY \"Users can manage their own fanmark profiles\" 
ON public.fanmark_profiles 
FOR ALL 
USING (auth.uid() = user_id)","CREATE POLICY \"Public can view public fanmark profiles\" 
ON public.fanmark_profiles 
FOR SELECT 
USING (is_public = true)","-- Create RLS policies for config tables (users can manage configs for their licensed fanmarks)
CREATE POLICY \"Users can manage configs for their licensed fanmarks\" 
ON public.fanmark_basic_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_basic_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","CREATE POLICY \"Users can manage redirect configs for their licensed fanmarks\" 
ON public.fanmark_redirect_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_redirect_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","CREATE POLICY \"Users can manage messageboard configs for their licensed fanmarks\" 
ON public.fanmark_messageboard_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_messageboard_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","CREATE POLICY \"Users can manage password configs for their licensed fanmarks\" 
ON public.fanmark_password_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_password_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","-- Create updated triggers for updated_at
CREATE TRIGGER update_fanmark_profiles_updated_at
BEFORE UPDATE ON public.fanmark_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_basic_configs_updated_at
BEFORE UPDATE ON public.fanmark_basic_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_redirect_configs_updated_at
BEFORE UPDATE ON public.fanmark_redirect_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_messageboard_configs_updated_at
BEFORE UPDATE ON public.fanmark_messageboard_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_password_configs_updated_at
BEFORE UPDATE ON public.fanmark_password_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- Create new function for public fanmark profile access
CREATE OR REPLACE FUNCTION public.get_public_fanmark_profile(profile_fanmark_id uuid)
RETURNS TABLE(id uuid, fanmark_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''public''
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
$function$"}', '3ada7c7a-978c-4539-8439-5217c658e980', NULL, NULL, NULL),
	('20250924125344', '{"-- Add access_type column to fanmark_basic_configs
ALTER TABLE public.fanmark_basic_configs 
ADD COLUMN access_type text NOT NULL DEFAULT ''inactive''","-- Migrate existing access_type data from fanmarks to fanmark_basic_configs
INSERT INTO public.fanmark_basic_configs (fanmark_id, access_type, fanmark_name)
SELECT 
  f.id as fanmark_id,
  f.access_type,
  f.emoji_combination as fanmark_name
FROM public.fanmarks f
LEFT JOIN public.fanmark_basic_configs bc ON f.id = bc.fanmark_id
WHERE bc.fanmark_id IS NULL
ON CONFLICT (fanmark_id) DO UPDATE SET
  access_type = EXCLUDED.access_type","-- Update existing records in fanmark_basic_configs with access_type from fanmarks
UPDATE public.fanmark_basic_configs 
SET access_type = f.access_type
FROM public.fanmarks f
WHERE fanmark_basic_configs.fanmark_id = f.id","-- Drop access_type column from fanmarks table
ALTER TABLE public.fanmarks DROP COLUMN access_type","-- Update get_fanmark_complete_data function
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, access_password text, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        f.status,
        f.created_at,
        f.updated_at,
        
        -- Basic config
        bc.fanmark_name,
        
        -- Access configs based on type
        rc.target_url,
        mc.content as text_content,
        
        -- Password protection
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password,
        
        -- License info (for ownership checking)
        fl.user_id as current_owner_id,
        fl.license_end,
        CASE 
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$","-- Update get_fanmark_by_emoji function
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active'';
END;
$function$"}', '48613986-a3c9-4986-b92f-73b916860134', NULL, NULL, NULL),
	('20250925123555', '{"-- Fix the security definer view warning by using a function approach instead

-- Drop the view that was flagged as a security issue
DROP VIEW IF EXISTS public.public_fanmark_profiles","-- Update the existing function to be more secure while maintaining functionality
-- This approach is safer than a SECURITY DEFINER view
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(
  fanmark_id uuid, 
  display_name text, 
  bio text, 
  social_links jsonb, 
  theme_settings jsonb, 
  created_at timestamp with time zone, 
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 
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
$$","-- Grant execute permission to both anon and authenticated users for public profile access
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon, authenticated"}', '1f7149ea-8127-4630-9399-415c81ac3135', NULL, NULL, NULL),
	('20250927022305', '{"-- Extend user_plan enum to include new plan types
ALTER TYPE user_plan ADD VALUE IF NOT EXISTS ''business''","ALTER TYPE user_plan ADD VALUE IF NOT EXISTS ''enterprise''","ALTER TYPE user_plan ADD VALUE IF NOT EXISTS ''admin''","-- Add new system settings for business and enterprise plans
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public) VALUES
  (''business_fanmarks_limit'', ''50'', ''Maximum fanmarks for business plan users'', true),
  (''business_pricing'', ''10000'', ''Monthly pricing for business plan (JPY)'', true),
  (''enterprise_fanmarks_limit'', ''100'', ''Default maximum fanmarks for enterprise plan users'', true),
  (''enterprise_pricing'', ''50000'', ''Default monthly pricing for enterprise plan (JPY)'', true)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public","-- Create table for individual enterprise user settings
CREATE TABLE IF NOT EXISTS public.enterprise_user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  custom_fanmarks_limit INTEGER,
  custom_pricing INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID -- admin who created this setting
)","-- Enable RLS on enterprise_user_settings
ALTER TABLE public.enterprise_user_settings ENABLE ROW LEVEL SECURITY","-- Create RLS policies for enterprise_user_settings
CREATE POLICY \"Only admins can manage enterprise user settings\" 
ON public.enterprise_user_settings 
FOR ALL 
USING (is_admin())
WITH CHECK (is_admin())","-- Create policy for enterprise users to view their own settings
CREATE POLICY \"Enterprise users can view their own settings\" 
ON public.enterprise_user_settings 
FOR SELECT 
USING (auth.uid() = user_id)","-- Add trigger for updated_at timestamp
CREATE TRIGGER update_enterprise_user_settings_updated_at
BEFORE UPDATE ON public.enterprise_user_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()"}', '424ecf4b-eb59-4e23-aa32-a73b32eda1ab', NULL, NULL, NULL),
	('20251212013433', '{"-- Rename setting key for consistency: max_fanmarks_per_user -> free_fanmarks_limit
UPDATE public.system_settings 
SET setting_key = ''free_fanmarks_limit'', updated_at = now()
WHERE setting_key = ''max_fanmarks_per_user''"}', '1ef52fba-6514-405c-a5cf-75874d11434c', NULL, NULL, NULL),
	('20250920054943', '{"-- Create a public view that only exposes safe fields for public profiles
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  username,
  display_name,
  bio,
  avatar_url,
  created_at
FROM public.profiles
WHERE is_public_profile = true","-- Grant SELECT permissions on the view to anonymous users
GRANT SELECT ON public.public_profiles TO anon","GRANT SELECT ON public.public_profiles TO authenticated","-- Update the existing RLS policy to be more restrictive for public access
DROP POLICY IF EXISTS \"Profile access policy\" ON public.profiles","-- Create separate policies for authenticated users and owners
CREATE POLICY \"Users can view their own complete profile\" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id)","-- Create a restrictive policy for public profile access that excludes sensitive data
-- This policy will only allow access to basic profile info, not subscription data
CREATE POLICY \"Public can view limited profile data\" 
ON public.profiles 
FOR SELECT 
USING (
  is_public_profile = true 
  AND auth.uid() IS NULL -- Only for non-authenticated users
)","-- For authenticated users who are not the owner, allow access to public profiles but limit fields
CREATE POLICY \"Authenticated users can view public profiles\" 
ON public.profiles 
FOR SELECT 
USING (
  is_public_profile = true 
  AND auth.uid() != user_id
  AND auth.uid() IS NOT NULL
)"}', '2550674d-ea94-4d04-8d07-4d9956986f89', NULL, NULL, NULL),
	('20250921012654', '{"-- Add new columns to fanmarks table for registration system
ALTER TABLE public.fanmarks 
ADD COLUMN access_type text NOT NULL DEFAULT ''inactive'',
ADD COLUMN target_url text,
ADD COLUMN text_content text,
ADD COLUMN display_name text,
ADD COLUMN is_transferable boolean NOT NULL DEFAULT true","-- Add check constraint for access_type
ALTER TABLE public.fanmarks 
ADD CONSTRAINT check_access_type 
CHECK (access_type IN (''profile'', ''redirect'', ''text'', ''inactive''))","-- Create emoji_profiles table for profile pages
CREATE TABLE public.emoji_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id uuid NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  bio text,
  social_links jsonb DEFAULT ''{}'',
  theme_settings jsonb DEFAULT ''{}'',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
)","-- Enable RLS on emoji_profiles
ALTER TABLE public.emoji_profiles ENABLE ROW LEVEL SECURITY","-- RLS policies for emoji_profiles
CREATE POLICY \"Users can view public emoji profiles\"
ON public.emoji_profiles
FOR SELECT
USING (is_public = true)","CREATE POLICY \"Users can manage their own emoji profiles\"
ON public.emoji_profiles
FOR ALL
USING (auth.uid() = user_id)","-- Add trigger for updated_at on emoji_profiles
CREATE TRIGGER update_emoji_profiles_updated_at
BEFORE UPDATE ON public.emoji_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- Add index for performance
CREATE INDEX idx_emoji_profiles_fanmark_id ON public.emoji_profiles(fanmark_id)","CREATE INDEX idx_emoji_profiles_user_id ON public.emoji_profiles(user_id)"}', 'dfcc8c87-777a-4275-a7e2-7e5c5a871938', NULL, NULL, NULL),
	('20250922151123', '{"-- CRITICAL SECURITY FIX: Enhance waitlist security and admin authentication
-- Address multiple security concerns with waitlist access and admin verification

-- 1. Create enhanced admin authentication with additional security checks
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  user_profile RECORD;
  session_valid BOOLEAN := false;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Get user profile with role information
  SELECT * INTO user_profile 
  FROM public.profiles 
  WHERE user_id = auth.uid() 
  AND role = ''admin'';

  -- If no admin profile found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Additional security check: verify session is recent (within last 4 hours)
  -- This prevents stale admin sessions from being used
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions 
    WHERE user_id = auth.uid() 
    AND created_at > NOW() - INTERVAL ''4 hours''
    AND NOT (aal IS NULL OR aal = '''')
  ) INTO session_valid;

  -- Log admin access attempt for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    ''ADMIN_CHECK'',
    ''system'',
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''ip_address'', COALESCE(current_setting(''request.headers'', true)::json->>''x-forwarded-for'', ''unknown''),
      ''user_agent'', COALESCE(current_setting(''request.headers'', true)::json->>''user-agent'', ''unknown''),
      ''session_valid'', session_valid,
      ''admin_check_result'', session_valid
    )
  );

  RETURN session_valid;
END;
$$","-- 2. Create function for secure waitlist access with comprehensive logging
CREATE OR REPLACE FUNCTION public.get_waitlist_secure(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  email_hash TEXT,  -- Return hash instead of actual email
  referral_source TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Verify admin access with enhanced security
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_WAITLIST_ACCESS'',
      ''waitlist'',
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''ip_address'', COALESCE(current_setting(''request.headers'', true)::json->>''x-forwarded-for'', ''unknown''),
        ''attempted_action'', ''get_waitlist_secure'',
        ''security_level'', ''HIGH_RISK''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to waitlist data'';
  END IF;

  -- Log authorized admin access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    ''AUTHORIZED_WAITLIST_ACCESS'',
    ''waitlist'',
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''record_count'', (SELECT COUNT(*) FROM public.waitlist),
      ''limit'', p_limit,
      ''offset'', p_offset,
      ''security_level'', ''ADMIN_VERIFIED''
    )
  );

  -- Return waitlist data with email hashed for additional security
  RETURN QUERY
  SELECT 
    w.id,
    encode(digest(w.email, ''sha256''), ''hex'') as email_hash,  -- Hash email for privacy
    w.referral_source,
    w.status,
    w.created_at
  FROM public.waitlist w
  ORDER BY w.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$","-- 3. Create function to get actual email (for legitimate admin use only)
CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''UNAUTHORIZED_EMAIL_ACCESS'',
      ''waitlist'',
      waitlist_id::text,
      jsonb_build_object(
        ''timestamp'', NOW(),
        ''security_level'', ''CRITICAL_RISK'',
        ''attempted_resource'', ''email_address''
      )
    );
    
    RAISE EXCEPTION ''Unauthorized access to email data'';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    ''EMAIL_ACCESS'',
    ''waitlist'',
    waitlist_id::text,
    jsonb_build_object(
      ''timestamp'', NOW(),
      ''security_level'', ''ADMIN_VERIFIED'',
      ''purpose'', ''email_retrieval''
    )
  );

  RETURN email_result;
END;
$$","-- 4. Update waitlist policies with enhanced security
DROP POLICY IF EXISTS \"Only admins can view waitlist data\" ON public.waitlist","-- New restrictive policy - no direct table access
CREATE POLICY \"Waitlist access only through secure functions\" 
ON public.waitlist 
FOR SELECT 
USING (false)","-- Block all direct access

-- Keep insert policy for user registration
-- The existing \"Anyone can join waitlist\" policy is fine for INSERT

-- 5. Grant execute permissions only to authenticated users
GRANT EXECUTE ON FUNCTION public.get_waitlist_secure(INTEGER, INTEGER) TO authenticated","GRANT EXECUTE ON FUNCTION public.get_waitlist_email_by_id(UUID) TO authenticated","GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated","-- 6. Create notification function for security alerts
CREATE OR REPLACE FUNCTION public.notify_security_breach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log critical security events
  IF NEW.action = ''UNAUTHORIZED_WAITLIST_ACCESS'' OR NEW.action = ''UNAUTHORIZED_EMAIL_ACCESS'' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE ''SECURITY ALERT: Unauthorized access attempt by user % at %'', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$$","-- 7. Create trigger for security monitoring
DROP TRIGGER IF EXISTS security_alert_trigger ON public.audit_logs","CREATE TRIGGER security_alert_trigger
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_security_breach()"}', '41096dbf-ebfe-4c16-9dfa-1bd80f117174', NULL, NULL, NULL),
	('20250924102756', '{"-- PHASE 1: Clear existing data and restructure tables (Clean slate version)

-- Clear existing data
DELETE FROM fanmarks","DELETE FROM fanmark_licenses","-- Drop existing function
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid)","DROP FUNCTION IF EXISTS public.get_public_fanmark_profile(uuid)","-- Drop views that depend on fanmarks columns
DROP VIEW IF EXISTS public.fanmark_search_auth_v1","DROP VIEW IF EXISTS public.fanmark_search_public_v1","DROP VIEW IF EXISTS public.my_fanmark_claims_v1","-- Drop ALL existing tables that we''re going to recreate
DROP TABLE IF EXISTS public.fanmark_profiles CASCADE","DROP TABLE IF EXISTS public.fanmark_basic_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_redirect_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_messageboard_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_password_configs CASCADE","-- Drop ALL existing RLS policies on fanmarks
DROP POLICY IF EXISTS \"Users can create their own fanmarks\" ON public.fanmarks","DROP POLICY IF EXISTS \"Users can update their own fanmarks\" ON public.fanmarks","DROP POLICY IF EXISTS \"Users can view their own fanmarks\" ON public.fanmarks","DROP POLICY IF EXISTS \"authenticated_search_fanmarks_limited\" ON public.fanmarks","DROP POLICY IF EXISTS \"anonymous_no_direct_access\" ON public.fanmarks","DROP POLICY IF EXISTS \"Fanmarks are accessible to authenticated users\" ON public.fanmarks","-- Remove columns from fanmarks table
ALTER TABLE fanmarks 
DROP COLUMN IF EXISTS user_id CASCADE,
DROP COLUMN IF EXISTS tier_level CASCADE,
DROP COLUMN IF EXISTS current_license_id CASCADE,
DROP COLUMN IF EXISTS is_transferable CASCADE,
DROP COLUMN IF EXISTS is_password_protected CASCADE,
DROP COLUMN IF EXISTS access_password CASCADE,
DROP COLUMN IF EXISTS fanmark_name CASCADE,
DROP COLUMN IF EXISTS target_url CASCADE,
DROP COLUMN IF EXISTS text_content CASCADE","-- Simplify fanmark_licenses table
ALTER TABLE fanmark_licenses 
DROP COLUMN IF EXISTS tier_level CASCADE","-- Create new simplified RLS policy for fanmarks table
CREATE POLICY \"Fanmarks are accessible to authenticated users\" 
ON public.fanmarks 
FOR SELECT 
USING (auth.uid() IS NOT NULL)","-- Create new fanmark_profiles table (renamed from emoji_profiles)
CREATE TABLE public.fanmark_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL,
  user_id UUID NOT NULL,
  display_name TEXT,
  bio TEXT,
  social_links JSONB DEFAULT ''{}''::jsonb,
  theme_settings JSONB DEFAULT ''{}''::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_basic_configs table
CREATE TABLE public.fanmark_basic_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_redirect_configs table
CREATE TABLE public.fanmark_redirect_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_messageboard_configs table
CREATE TABLE public.fanmark_messageboard_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Create fanmark_password_configs table
CREATE TABLE public.fanmark_password_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id UUID NOT NULL UNIQUE,
  access_password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
)","-- Enable RLS on new tables
ALTER TABLE public.fanmark_profiles ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_basic_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_redirect_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_messageboard_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_password_configs ENABLE ROW LEVEL SECURITY","-- Create RLS policies for fanmark_profiles
CREATE POLICY \"Users can manage their own fanmark profiles\" 
ON public.fanmark_profiles 
FOR ALL 
USING (auth.uid() = user_id)","CREATE POLICY \"Public can view public fanmark profiles\" 
ON public.fanmark_profiles 
FOR SELECT 
USING (is_public = true)","-- Create RLS policies for config tables
CREATE POLICY \"Users can manage configs for their licensed fanmarks\" 
ON public.fanmark_basic_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_basic_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","CREATE POLICY \"Users can manage redirect configs for their licensed fanmarks\" 
ON public.fanmark_redirect_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_redirect_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","CREATE POLICY \"Users can manage messageboard configs for their licensed fanmarks\" 
ON public.fanmark_messageboard_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_messageboard_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","CREATE POLICY \"Users can manage password configs for their licensed fanmarks\" 
ON public.fanmark_password_configs 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_licenses fl 
    WHERE fl.fanmark_id = fanmark_password_configs.fanmark_id 
    AND fl.user_id = auth.uid() 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  )
)","-- Create triggers for updated_at
CREATE TRIGGER update_fanmark_profiles_updated_at
BEFORE UPDATE ON public.fanmark_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_basic_configs_updated_at
BEFORE UPDATE ON public.fanmark_basic_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_redirect_configs_updated_at
BEFORE UPDATE ON public.fanmark_redirect_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_messageboard_configs_updated_at
BEFORE UPDATE ON public.fanmark_messageboard_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_password_configs_updated_at
BEFORE UPDATE ON public.fanmark_password_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()","-- Create new function for public fanmark profile access
CREATE OR REPLACE FUNCTION public.get_public_fanmark_profile(profile_fanmark_id uuid)
RETURNS TABLE(id uuid, fanmark_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''public''
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
$function$"}', 'abe9a6df-2566-4acb-b1f0-edb9b4fea891', NULL, NULL, NULL),
	('20250924145043', '{"-- Add a new RLS policy to allow checking fanmark availability without revealing owner details
CREATE POLICY \"Anyone can check fanmark license status for availability\" 
ON public.fanmark_licenses 
FOR SELECT 
USING (
  -- Allow viewing license existence for availability checking
  -- Only expose minimal data needed for availability determination
  status = ''active'' AND license_end > now()
)","-- Create a secure function to check fanmark availability
CREATE OR REPLACE FUNCTION public.check_fanmark_availability(fanmark_uuid uuid)
RETURNS TABLE(
  is_available boolean,
  has_active_license boolean
) 
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''public''
AS $$
  SELECT 
    CASE 
      WHEN fl.id IS NULL THEN true
      WHEN fl.status = ''active'' AND fl.license_end > now() THEN false
      ELSE true
    END as is_available,
    CASE 
      WHEN fl.status = ''active'' AND fl.license_end > now() THEN true
      ELSE false
    END as has_active_license
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  WHERE f.id = fanmark_uuid
  LIMIT 1;
$$"}', '2d62af1b-74ba-4af7-b0e0-2cbef6fc5927', NULL, NULL, NULL),
	('20250925230330', '{"-- First, drop existing functions that we need to modify
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text)","DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text)","-- Remove the permissive RLS policy that allows direct access to password configs
DROP POLICY IF EXISTS \"Users can manage password configs for their licensed fanmarks\" ON public.fanmark_password_configs","-- Create a restrictive RLS policy that denies all direct access
CREATE POLICY \"Deny direct access to password configs\" 
ON public.fanmark_password_configs 
FOR ALL 
USING (false) 
WITH CHECK (false)","-- Create a secure function to verify passwords without exposing them
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
$$","-- Create a secure function for fanmark owners to manage password configs
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
      AND fl.status = ''active'' 
      AND fl.license_end > now()
  ) THEN
    RAISE EXCEPTION ''Unauthorized: User does not have active license for this fanmark'';
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
$$","-- Create a function to check if a fanmark has password protection enabled
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
$$","-- Recreate the get_fanmark_by_emoji function without password exposure
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
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
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
    AND f.status = ''active'';
END;
$$","-- Recreate the get_fanmark_complete_data function without password exposure
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
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, ''inactive'') as access_type,
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
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license
        
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$$"}', '0fd3e59b-7e57-43cb-9ef6-4c2bab57f661', NULL, NULL, NULL),
	('20250927052011', '{"-- Add plan exclusion columns to fanmark_licenses table for plan downgrade functionality
ALTER TABLE fanmark_licenses
ADD COLUMN plan_excluded boolean DEFAULT false,
ADD COLUMN excluded_at timestamp with time zone,
ADD COLUMN excluded_from_plan text"}', '1af44fb8-9285-4c57-854e-c5ae3194891d', NULL, NULL, NULL),
	('20251216222312', '{"-- Delete the orphaned user_subscriptions record for the cancelled subscription
DELETE FROM public.user_subscriptions 
WHERE id = ''0472d065-6332-4839-adc0-9b5f13707006''"}', 'f8d9047a-4ddb-46dc-9117-fb520dbb8aed', NULL, NULL, NULL),
	('20250920060808', '{"-- Drop the previous view and recreate it without SECURITY DEFINER
DROP VIEW IF EXISTS public.public_profiles","-- Create a simple view that inherits the user''s permissions
CREATE VIEW public.public_profiles AS
SELECT 
  id,
  username,
  display_name,
  bio,
  avatar_url,
  created_at
FROM public.profiles
WHERE is_public_profile = true","-- The view will inherit RLS policies from the underlying table
-- Grant SELECT permissions on the view
GRANT SELECT ON public.public_profiles TO anon","GRANT SELECT ON public.public_profiles TO authenticated","-- Now let''s fix the RLS policies to work properly with the view
-- We need to update the policies to allow the view to work correctly

-- Drop existing policies
DROP POLICY IF EXISTS \"Public can view limited profile data\" ON public.profiles","DROP POLICY IF EXISTS \"Authenticated users can view public profiles\" ON public.profiles","-- Create a single policy for public profile access
-- This will work with both direct table access and view access
CREATE POLICY \"Public profiles are viewable by everyone\" 
ON public.profiles 
FOR SELECT 
USING (is_public_profile = true)","-- The owner policy remains the same
-- Users can still view their complete profile including sensitive data"}', '75b4f57a-a0da-4216-ba1d-fe93af127a8a', NULL, NULL, NULL),
	('20250921045245', '{"-- Fix security issue: Restrict public_profile_cache access to authenticated users only
-- This prevents anonymous mass scraping while maintaining functionality for legitimate users

-- Drop the overly permissive policy
DROP POLICY IF EXISTS \"Public can select cached profiles\" ON public.public_profile_cache","-- Create a more secure policy that requires authentication
CREATE POLICY \"Authenticated users can view public profile cache\" 
ON public.public_profile_cache 
FOR SELECT 
TO authenticated
USING (true)","-- Optional: Add rate limiting by creating a more restrictive policy for frequent access
-- This helps prevent even authenticated users from mass scraping
CREATE POLICY \"Service role can access profile cache for system operations\"
ON public.public_profile_cache
FOR SELECT 
TO service_role
USING (true)","-- Add audit logging for profile cache access (optional security enhancement)
-- This will help monitor access patterns and detect potential abuse
CREATE OR REPLACE FUNCTION public.log_profile_cache_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log if accessing multiple profiles (potential scraping behavior)
  -- This is a placeholder for more sophisticated monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    ''SELECT'',
    ''public_profile_cache'',
    NEW.id::text,
    json_build_object(
      ''accessed_at'', now(),
      ''user_agent'', current_setting(''request.headers'', true)::json->>''user-agent''
    )
  );
  RETURN NEW;
END;
$$","-- Note: Trigger creation for audit logging would require careful consideration
-- as it could impact performance. For now, we''ll rely on the authentication requirement."}', 'b624dde3-a967-46a8-8775-5396e8653731', NULL, NULL, NULL),
	('20250922151154', '{"-- Fix function search path security warnings
-- Add proper search_path settings to all functions for security

-- Fix notify_security_breach function
CREATE OR REPLACE FUNCTION public.notify_security_breach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
BEGIN
  -- Log critical security events
  IF NEW.action = ''UNAUTHORIZED_WAITLIST_ACCESS'' OR NEW.action = ''UNAUTHORIZED_EMAIL_ACCESS'' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE ''SECURITY ALERT: Unauthorized access attempt by user % at %'', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$$"}', '476eeaf1-1fe9-467a-8860-372b983ed08b', NULL, NULL, NULL),
	('20250927062959', '{"-- Drop existing tables and functions, then recreate with license_id structure
-- This will delete all existing data as requested

-- Drop existing functions first to avoid conflicts
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text) CASCADE","DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text) CASCADE","DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text) CASCADE","DROP FUNCTION IF EXISTS public.upsert_fanmark_password_config(uuid, text, boolean) CASCADE","DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid) CASCADE","-- Drop existing configuration tables
DROP TABLE IF EXISTS public.fanmark_basic_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_redirect_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_messageboard_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_password_configs CASCADE","DROP TABLE IF EXISTS public.fanmark_profiles CASCADE","-- Recreate fanmark_basic_configs with license_id
CREATE TABLE public.fanmark_basic_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    fanmark_name text,
    access_type text NOT NULL DEFAULT ''inactive''::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
)","-- Recreate fanmark_redirect_configs with license_id
CREATE TABLE public.fanmark_redirect_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    target_url text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
)","-- Recreate fanmark_messageboard_configs with license_id
CREATE TABLE public.fanmark_messageboard_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    content text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
)","-- Recreate fanmark_password_configs with license_id
CREATE TABLE public.fanmark_password_configs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    access_password text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
)","-- Recreate fanmark_profiles with license_id only
CREATE TABLE public.fanmark_profiles (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
    display_name text,
    bio text,
    social_links jsonb DEFAULT ''{}''::jsonb,
    theme_settings jsonb DEFAULT ''{}''::jsonb,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(license_id)
)","-- Enable RLS on all tables
ALTER TABLE public.fanmark_basic_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_redirect_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_messageboard_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_password_configs ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_profiles ENABLE ROW LEVEL SECURITY","-- Create RLS policies
CREATE POLICY \"Users can manage configs for their own licenses\" ON public.fanmark_basic_configs
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_basic_configs.license_id
        AND fl.user_id = auth.uid()
        AND fl.status = ''active''
        AND fl.license_end > now()
    )
)","CREATE POLICY \"Users can manage redirect configs for their own licenses\" ON public.fanmark_redirect_configs
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_redirect_configs.license_id
        AND fl.user_id = auth.uid()
        AND fl.status = ''active''
        AND fl.license_end > now()
    )
)","CREATE POLICY \"Users can manage messageboard configs for their own licenses\" ON public.fanmark_messageboard_configs
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_messageboard_configs.license_id
        AND fl.user_id = auth.uid()
        AND fl.status = ''active''
        AND fl.license_end > now()
    )
)","CREATE POLICY \"Deny direct access to password configs\" ON public.fanmark_password_configs
FOR ALL USING (false) WITH CHECK (false)","CREATE POLICY \"Users can manage their own fanmark profiles\" ON public.fanmark_profiles
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.fanmark_licenses fl
        WHERE fl.id = fanmark_profiles.license_id
        AND fl.user_id = auth.uid()
    )
)","-- Add triggers for updated_at
CREATE TRIGGER update_fanmark_basic_configs_updated_at
    BEFORE UPDATE ON public.fanmark_basic_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_redirect_configs_updated_at
    BEFORE UPDATE ON public.fanmark_redirect_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_messageboard_configs_updated_at
    BEFORE UPDATE ON public.fanmark_messageboard_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_password_configs_updated_at
    BEFORE UPDATE ON public.fanmark_password_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column()","CREATE TRIGGER update_fanmark_profiles_updated_at
    BEFORE UPDATE ON public.fanmark_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column()","-- Recreate functions with new structure

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
SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, ''inactive'') as access_type,
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
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license,
        fl.id as license_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
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
$function$","-- get_fanmark_by_emoji updated
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
SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        f.short_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.normalized_emoji = emoji_combo
    AND f.status = ''active'';
END;
$function$","-- get_fanmark_by_short_id updated
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
SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
    AND f.status = ''active'';
END;
$function$","-- upsert_fanmark_password_config with license_id
CREATE OR REPLACE FUNCTION public.upsert_fanmark_password_config(license_uuid uuid, new_password text, enable_password boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
    config_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM public.fanmark_licenses fl
        WHERE fl.id = license_uuid 
          AND fl.user_id = auth.uid() 
          AND fl.status = ''active'' 
          AND fl.license_end > now()
    ) THEN
        RAISE EXCEPTION ''Unauthorized: User does not have active license'';
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
$function$","-- get_public_emoji_profile with license_id
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
SET search_path TO ''public''
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
$function$"}', '278df04d-48bd-4d35-a2bc-0126732b6e71', NULL, NULL, NULL),
	('20251223090000', '{"-- Ensure fanmark availability checks treat grace-period licenses as occupied

DROP FUNCTION IF EXISTS public.check_fanmark_availability_secure(uuid)","DROP FUNCTION IF EXISTS public.check_fanmark_availability(uuid)","DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[])","CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid
      AND (
        (fl.status = ''active'' AND fl.license_end > now())
        OR (fl.status = ''grace'' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count int;
  missing_count int;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_emoji_ids'');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level, monthly_price_usd, initial_license_days
    INTO tier_info
    FROM public.fanmark_tiers
    WHERE emoji_count_min <= emoji_count
      AND emoji_count_max >= emoji_count
      AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  END IF;

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = ''grace'' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = ''active'' AND fl.license_end > now())
      OR (fl.status = ''grace'' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = ''grace'' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = ''grace'' THEN ''grace_period''
      ELSE ''taken''
    END;
  END IF;

  RETURN json_build_object(
    ''available'', is_available,
    ''fanmark_id'', fanmark_record.id,
    ''reason'', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    ''available_at'', available_at,
    ''blocking_status'', blocking_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL::uuid,
  emoji_ids_param uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
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
  license_id uuid,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  is_blocked_for_registration boolean,
  next_available_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '''' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    latest.user_id AS current_owner_id,
    latest.license_end,
    CASE
      WHEN latest.status = ''active'' AND latest.license_end > now() THEN true
      ELSE false
    END AS has_active_license,
    latest.id AS license_id,
    latest.status AS current_license_status,
    latest.grace_expires_at AS current_grace_expires_at,
    CASE
      WHEN latest.status = ''active'' AND latest.license_end > now() THEN true
      WHEN latest.status = ''grace'' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN true
      ELSE false
    END AS is_blocked_for_registration,
    CASE
      WHEN latest.status = ''grace'' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN COALESCE(latest.grace_expires_at, latest.license_end)
      WHEN latest.status = ''active'' AND latest.license_end > now() THEN latest.license_end
      ELSE NULL
    END AS next_available_at
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl.*
    FROM fanmark_licenses fl
    WHERE fl.fanmark_id = f.id
    ORDER BY fl.license_end DESC NULLS LAST
    LIMIT 1
  ) AS latest ON true
  LEFT JOIN fanmark_basic_configs bc ON latest.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON latest.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON latest.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON latest.id = pc.license_id
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$"}', 'update_fanmark_grace_availability', NULL, NULL, NULL),
	('20250920061525', '{"-- 1) Create a cache table that only stores NON-sensitive public fields
CREATE TABLE IF NOT EXISTS public.public_profile_cache (
  id uuid PRIMARY KEY,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
)","-- 2) Enable RLS and allow public read on the cache only
ALTER TABLE public.public_profile_cache ENABLE ROW LEVEL SECURITY","DROP POLICY IF EXISTS \"Public can select cached profiles\" ON public.public_profile_cache","CREATE POLICY \"Public can select cached profiles\"
ON public.public_profile_cache
FOR SELECT
USING (true)","GRANT SELECT ON public.public_profile_cache TO anon","GRANT SELECT ON public.public_profile_cache TO authenticated","-- 3) Sync trigger to keep cache in sync with profiles while excluding sensitive fields
CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = ''DELETE'' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$","DROP TRIGGER IF EXISTS trg_sync_public_profile_cache ON public.profiles","CREATE TRIGGER trg_sync_public_profile_cache
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_cache()","-- 4) Backfill current public profiles into the cache
INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
SELECT id, username, display_name, bio, avatar_url, created_at
FROM public.profiles
WHERE is_public_profile = true
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  avatar_url = EXCLUDED.avatar_url,
  created_at = EXCLUDED.created_at","-- 5) Recreate the public view to read from the cache only (safe fields only)
DROP VIEW IF EXISTS public.public_profiles","CREATE VIEW public.public_profiles AS
SELECT id, username, display_name, bio, avatar_url, created_at
FROM public.public_profile_cache","GRANT SELECT ON public.public_profiles TO anon","GRANT SELECT ON public.public_profiles TO authenticated","-- 6) Tighten base table RLS - remove public access to profiles
DROP POLICY IF EXISTS \"Public profiles are viewable by everyone\" ON public.profiles","-- Keep owner-only read policy created earlier:
--   CREATE POLICY \"Users can view their own complete profile\" ON public.profiles FOR SELECT USING (auth.uid() = user_id);"}', 'a0590047-bfc5-4195-a89b-a329b705fd69', NULL, NULL, NULL),
	('20250922055623', '{"-- Disable all availability rules to make all fanmarks free
UPDATE public.fanmark_availability_rules 
SET is_available = false 
WHERE is_available = true"}', '6ce9e7dd-b544-41b0-9f33-59223ea9f955', NULL, NULL, NULL),
	('20250923065905', '{"-- Fix fanmarks table security vulnerability by removing overly permissive public access
-- while preserving legitimate functionality

-- Drop the overly permissive public read policy
DROP POLICY IF EXISTS \"read_active_fanmarks_public\" ON public.fanmarks","-- Create a more secure policy for anonymous users that only allows access to basic fanmark data
-- for search functionality without exposing user ownership data
CREATE POLICY \"anonymous_search_fanmarks_limited\" ON public.fanmarks
FOR SELECT 
USING (
  status = ''active'' 
  AND auth.uid() IS NULL
)","-- Create a policy for authenticated users to search fanmarks without seeing user ownership
-- This allows search functionality while protecting user privacy
CREATE POLICY \"authenticated_search_fanmarks_limited\" ON public.fanmarks
FOR SELECT 
USING (
  status = ''active'' 
  AND auth.uid() IS NOT NULL 
  AND auth.uid() != user_id
)","-- The existing policies for users to see their own fanmarks remain:
-- \"Users can view their own fanmarks\" - SELECT policy using auth.uid() = user_id
-- \"Users can update their own fanmarks\" - UPDATE policy using auth.uid() = user_id  
-- \"Users can create their own fanmarks\" - INSERT policy with check auth.uid() = user_id

-- Create a secure view for public fanmark search that excludes sensitive user data
CREATE OR REPLACE VIEW public.fanmarks_public_search AS
SELECT 
  id,
  emoji_combination,
  normalized_emoji,
  short_id,
  tier_level,
  status,
  current_license_id,
  created_at
FROM public.fanmarks
WHERE status = ''active''","-- Grant access to the public search view
GRANT SELECT ON public.fanmarks_public_search TO authenticated","GRANT SELECT ON public.fanmarks_public_search TO anon","-- Update the get_fanmark_by_emoji function to ensure it continues working correctly
-- This function already has SECURITY DEFINER so it will work regardless of RLS policies
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
  emoji_combination text, 
  display_name text, 
  access_type text, 
  target_url text, 
  text_content text, 
  status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''public''
AS $function$
  SELECT 
    f.emoji_combination,
    f.display_name,
    f.access_type,
    f.target_url,
    f.text_content,
    f.status
  FROM public.fanmarks f
  WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active''
  LIMIT 1;
$function$"}', '0f9dbf5c-76e8-4965-8f27-3ee27e326265', NULL, NULL, NULL),
	('20250924103117', '{"-- Create compatibility function for existing frontend
CREATE OR REPLACE FUNCTION get_public_emoji_profile(profile_fanmark_id UUID)
RETURNS TABLE (
    id UUID,
    fanmark_id UUID,
    user_id UUID,
    display_name TEXT,
    bio TEXT,
    social_links JSONB,
    theme_settings JSONB,
    is_public BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fp.id,
        fp.fanmark_id,
        fp.user_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.is_public,
        fp.created_at,
        fp.updated_at
    FROM fanmark_profiles fp
    WHERE fp.fanmark_id = profile_fanmark_id
    AND fp.is_public = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER"}', '80c26673-51b7-4cf5-b81d-924d1be023aa', NULL, NULL, NULL),
	('20250924151415', '{"-- Add composite unique constraint to fanmark_profiles table
-- This ensures one user can only have one profile per fanmark
-- and enables the upsert operation in useEmojiProfile.tsx to work correctly

ALTER TABLE public.fanmark_profiles 
ADD CONSTRAINT fanmark_profiles_fanmark_id_user_id_unique 
UNIQUE (fanmark_id, user_id)"}', 'a3dc6f75-570b-4165-b2da-2703b8c2c2b8', NULL, NULL, NULL),
	('20250927154344', '{"-- Enable pg_net extension for HTTP requests in cron jobs
CREATE EXTENSION IF NOT EXISTS pg_net","-- Grant necessary permissions for the cron job to use pg_net
GRANT EXECUTE ON FUNCTION net.http_post TO postgres","-- Verify the extension is enabled
SELECT * FROM pg_extension WHERE extname = ''pg_net''"}', '9e616a81-3ee0-4ff9-96d9-355b1d803be4', NULL, NULL, NULL),
	('20250312090000', '{"-- Update admin helper functions to use user_settings.plan_type
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_settings us
    where us.user_id = current_user_id
      and us.plan_type = ''admin''
  );
end;
$$","comment on function public.is_admin is
''Returns TRUE when the current authenticated user has the admin plan''","revoke all on function public.is_admin from public","grant execute on function public.is_admin() to authenticated","-- Align is_super_admin with the new admin detection and keep security logging
create or replace function public.is_super_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  has_recent_session boolean := false;
  is_admin_user boolean := false;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return false;
  end if;

  select true
  into is_admin_user
  from public.user_settings us
  where us.user_id = current_user_id
    and us.plan_type = ''admin''
  limit 1;

  if not is_admin_user then
    return false;
  end if;

  -- Require a recent session within the last 4 hours (same behaviour as before)
  select exists(
    select 1
    from auth.sessions s
    where s.user_id = current_user_id
      and s.created_at > now() - interval ''4 hours''
      and coalesce(s.aal, '''') <> ''''
  )
  into has_recent_session;

  insert into public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) values (
    current_user_id,
    ''ADMIN_CHECK'',
    ''system'',
    jsonb_build_object(
      ''timestamp'', now(),
      ''session_valid'', has_recent_session,
      ''admin_check_result'', has_recent_session
    )
  );

  return has_recent_session;
end;
$$","comment on function public.is_super_admin is
''Additional guard for critical operations. Requires admin plan and a recent valid session.''","revoke all on function public.is_super_admin from public","grant execute on function public.is_super_admin() to authenticated"}', 'admin_user_management', NULL, NULL, NULL),
	('20250214120000', '{"-- Add price_id column to user_subscriptions for tracking Stripe Price IDs
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS price_id TEXT","COMMENT ON COLUMN public.user_subscriptions.price_id IS ''Stripe Price ID associated with the active subscription''"}', 'add_price_id_to_user_subscriptions', NULL, NULL, NULL),
	('20250920065405', '{"-- Fix security definer issue by updating the sync function to not use SECURITY DEFINER
-- The function doesn''t need elevated privileges since it''s just syncing data

CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = ''DELETE'' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$"}', '58eae792-0521-4671-b122-8bcf331470ce', NULL, NULL, NULL),
	('20250922115651', '{"-- Delete old fanmark records without license information
DELETE FROM fanmarks 
WHERE current_license_id IS NULL"}', 'fe01eec2-3ff0-4cab-81a0-bde06410c0cd', NULL, NULL, NULL),
	('20250923065941', '{"-- Fix the security definer view issue by dropping it and using a regular view instead
-- The view wasn''t needed since we have proper RLS policies

-- Drop the problematic security definer view
DROP VIEW IF EXISTS public.fanmarks_public_search","-- We don''t need a separate view since our RLS policies now properly control access
-- The search functionality will use the existing fanmarks table with the new restrictive policies:
-- 1. anonymous_search_fanmarks_limited - for anonymous users
-- 2. authenticated_search_fanmarks_limited - for authenticated users (excludes their own)
-- 3. Users can view their own fanmarks - for users to see their own data

-- The get_fanmark_by_emoji function remains for legitimate public access to fanmarks by URL"}', '095c6313-1052-4ace-830d-6431c00fc347', NULL, NULL, NULL),
	('20250924103549', '{"-- Update get_fanmark_by_emoji function to work with new schema
CREATE OR REPLACE FUNCTION get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE (
    emoji_combination text,
    fanmark_name text,
    access_type text,
    target_url text,
    text_content text,
    status text,
    is_password_protected boolean,
    access_password text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.emoji_combination,
        COALESCE(bc.display_name, f.emoji_combination) as fanmark_name,
        f.access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active'';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public","-- Create view for complete fanmark data
CREATE OR REPLACE VIEW fanmark_complete_view AS
SELECT 
    f.id,
    f.emoji_combination,
    f.normalized_emoji,
    f.short_id,
    f.access_type,
    f.status,
    f.created_at,
    f.updated_at,
    
    -- Basic config
    bc.display_name as fanmark_name,
    
    -- Access configs based on type
    rc.target_url,
    mc.content as text_content,
    
    -- Password protection
    CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
    pc.access_password,
    
    -- License info (for ownership checking)
    fl.user_id as current_owner_id,
    fl.license_end,
    CASE 
        WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
        ELSE false 
    END as has_active_license
    
FROM fanmarks f
LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = ''active'' 
    AND fl.license_end > now()"}', 'b068a791-69d2-4611-aa7a-3a265d6eb179', NULL, NULL, NULL),
	('20250924152257', '{"-- Drop and recreate get_fanmark_by_emoji function with updated return type
-- This will allow FanmarkProfile component to fetch profile data correctly

DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(id uuid, emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, access_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        CASE WHEN pc.access_password IS NOT NULL THEN true ELSE false END as is_password_protected,
        pc.access_password
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.emoji_combination = emoji_combo 
    AND f.status = ''active'';
END;
$function$"}', '7601e3dc-93bb-434e-be1f-9edcb2fddef9', NULL, NULL, NULL),
	('20250927082700', '{"-- Update get_fanmark_by_emoji to include short_id for redirect capability
-- First drop the existing function to avoid return type conflicts
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
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
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        f.short_id
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.normalized_emoji = emoji_combo
    AND f.status = ''active'';
END;
$$","-- Create function to get fanmark data by short_id
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
SET search_path = ''public''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.short_id = shortid_param
    AND f.status = ''active'';
END;
$$"}', 'add_shortid_lookup', NULL, NULL, NULL),
	('20250927132024', '{"-- Add plan exclusion fields to fanmark_licenses table
-- This migration adds fields to support plan downgrade functionality
-- where users can exclude fanmarks from their plan while keeping them until expiration

-- Add new columns to fanmark_licenses table
ALTER TABLE fanmark_licenses
ADD COLUMN plan_excluded boolean DEFAULT false,
ADD COLUMN excluded_at timestamp with time zone,
ADD COLUMN excluded_from_plan text","-- Add index for efficient querying of plan excluded licenses
CREATE INDEX idx_fanmark_licenses_plan_excluded
ON fanmark_licenses (plan_excluded, excluded_at)
WHERE plan_excluded = true","-- Add index for efficient expiration checks on plan excluded licenses
CREATE INDEX idx_fanmark_licenses_plan_excluded_status_end
ON fanmark_licenses (plan_excluded, status, license_end)
WHERE plan_excluded = true","-- Add comment to document the purpose
COMMENT ON COLUMN fanmark_licenses.plan_excluded IS ''Indicates if this license is excluded from the user plan (due to downgrade)''","COMMENT ON COLUMN fanmark_licenses.excluded_at IS ''Timestamp when the license was excluded from the plan''","COMMENT ON COLUMN fanmark_licenses.excluded_from_plan IS ''The plan type the user downgraded from (for audit purposes)''"}', 'add_plan_exclusion_to_fanmark_licenses', NULL, NULL, NULL),
	('20250927134345', '{"-- Fix verify_fanmark_password function to use correct license_id lookup
DROP FUNCTION IF EXISTS public.verify_fanmark_password(uuid, text)","CREATE OR REPLACE FUNCTION public.verify_fanmark_password(fanmark_uuid uuid, provided_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $$
DECLARE
  stored_password text;
  is_enabled boolean;
BEGIN
  -- Get the password configuration for the fanmark through license
  SELECT 
    pc.access_password,
    pc.is_enabled
  INTO stored_password, is_enabled
  FROM public.fanmarks f
  JOIN public.fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = ''active'' 
    AND fl.license_end > now()
  JOIN public.fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.id = fanmark_uuid;
  
  -- Return false if no password config found or not enabled
  IF stored_password IS NULL OR is_enabled IS FALSE THEN
    RETURN false;
  END IF;
  
  -- Return true if passwords match
  RETURN stored_password = provided_password;
END;
$$"}', '95c1fdc0-df88-4087-b184-b6ca5cc5b122', NULL, NULL, NULL),
	('20250927141349', '{"-- Update grace period to 1 day for cooldown processing
UPDATE system_settings 
SET setting_value = ''1'', updated_at = now()
WHERE setting_key = ''grace_period_days''","-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron","-- Create a cron job to run check-expired-licenses daily at 0:00 JST
SELECT cron.schedule(
  ''check-expired-licenses-daily'',
  ''0 15 * * *'', -- 15:00 UTC = 0:00 JST (considering JST is UTC+9)
  $$
  SELECT
    net.http_post(
        url:=''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses'',
        headers:=''{\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o\"}''::jsonb,
        body:=''{\"scheduled\": true}''::jsonb
    ) as request_id;
  $$
)"}', '6433185d-f5a1-4e57-9ca0-fd3de2f56579', NULL, NULL, NULL),
	('20250927141526', '{"-- Update grace period to 1 day for cooldown processing
UPDATE system_settings 
SET setting_value = ''1'', updated_at = now()
WHERE setting_key = ''grace_period_days''","-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron","-- Create a cron job to run check-expired-licenses daily at 0:00 JST
SELECT cron.schedule(
  ''check-expired-licenses-daily'',
  ''0 15 * * *'', -- 15:00 UTC = 0:00 JST (considering JST is UTC+9)
  $$
  SELECT
    net.http_post(
        url:=''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses'',
        headers:=''{\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o\"}''::jsonb,
        body:=''{\"scheduled\": true}''::jsonb
    ) as request_id;
  $$
)"}', 'cc6a8288-6e5b-4128-9ead-08b04d31b6d6', NULL, NULL, NULL),
	('20250927145222', '{"-- Drop the existing function first
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text)","-- Recreate the function with is_public included
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_combo_param text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, emoji_combination text, normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean, license_id uuid, is_public boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.emoji_combination,
        f.normalized_emoji,
        f.short_id,
        COALESCE(bc.access_type, ''inactive'') as access_type,
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
            WHEN fl.status = ''active'' AND fl.license_end > now() THEN true 
            ELSE false 
        END as has_active_license,
        fl.id as license_id,
        COALESCE(fp.is_public, true) as is_public
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    LEFT JOIN fanmark_profiles fp ON fl.id = fp.license_id
    WHERE 
        (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
        OR 
        (emoji_combo_param IS NOT NULL AND f.emoji_combination = emoji_combo_param);
END;
$function$"}', '04863fda-8ab2-4044-b136-8237cae5ef51', NULL, NULL, NULL),
	('20250929091246', '{"-- Create fanmark_favorites table for bookmark functionality
CREATE TABLE public.fanmark_favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fanmark_id UUID NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, fanmark_id)
)","-- Enable RLS
ALTER TABLE public.fanmark_favorites ENABLE ROW LEVEL SECURITY","-- Create policies for fanmark_favorites
CREATE POLICY \"Users can manage their own favorites\" 
ON public.fanmark_favorites 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)","-- Create comprehensive fanmark details function
CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  -- Basic fanmark info
  fanmark_id uuid,
  emoji_combination text,
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  
  -- Current license info
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  is_currently_active boolean,
  
  -- First acquisition info
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  
  -- History data (JSON array)
  license_history jsonb,
  
  -- Favorite status for current user
  is_favorited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  -- Get fanmark basic info
  SELECT f.id, f.emoji_combination, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = ''active'';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH current_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end,
      (fl.status = ''active'' AND fl.license_end > now()) as is_active
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
      AND fl.status = ''active'' 
      AND fl.license_end > now()
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.emoji_combination,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    cl.license_id,
    cl.username,
    cl.display_name,
    cl.license_start,
    cl.license_end,
    COALESCE(cl.is_active, false),
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, ''[]''::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM current_license cl
  CROSS JOIN first_license fl
  CROSS JOIN history h
  CROSS JOIN favorite_status fs;
END;
$$","-- Create function to toggle favorites
CREATE OR REPLACE FUNCTION public.toggle_fanmark_favorite(fanmark_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $$
DECLARE
  current_user_id uuid;
  is_favorited boolean;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION ''User must be authenticated'';
  END IF;
  
  -- Check if already favorited
  SELECT EXISTS(
    SELECT 1 FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id
  ) INTO is_favorited;
  
  IF is_favorited THEN
    -- Remove favorite
    DELETE FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id;
    RETURN false;
  ELSE
    -- Add favorite
    INSERT INTO public.fanmark_favorites (fanmark_id, user_id) 
    VALUES (fanmark_uuid, current_user_id);
    RETURN true;
  END IF;
END;
$$"}', '78a1238d-0d66-4c91-b5d9-84485befa334', NULL, NULL, NULL),
	('20251020031948', '{"-- Phase 7: Cron設定 - 通知イベント処理を毎分実行

-- pg_cron拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS pg_cron","-- pg_net拡張機能を有効化（HTTP呼び出しに必要）
CREATE EXTENSION IF NOT EXISTS pg_net","-- 既存のCronジョブを削除（存在する場合）
SELECT cron.unschedule(''process-notification-events-every-minute'') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = ''process-notification-events-every-minute''
)","-- 通知イベント処理を毎分実行するCronジョブを作成
SELECT cron.schedule(
  ''process-notification-events-every-minute'',
  ''* * * * *'', -- 毎分実行
  $$
  SELECT
    net.http_post(
        url:=''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/process-notification-events'',
        headers:=''{\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o\"}''::jsonb,
        body:=concat(''{\"timestamp\": \"'', now(), ''\"}'')::jsonb
    ) as request_id;
  $$
)"}', 'b0c00939-5e62-4d0f-81ef-754a0baeb326', NULL, NULL, NULL),
	('20250927150840', '{"-- Update get_fanmark_by_emoji function to include license_id in the return type
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
 RETURNS TABLE(id uuid, emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, short_id text, license_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        f.short_id,
        fl.id as license_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.normalized_emoji = emoji_combo
    AND f.status = ''active'';
END;
$function$"}', 'b60cd387-b07e-4908-b8ec-5664d13ac0af', NULL, NULL, NULL),
	('20250927151357', '{"-- Update get_fanmark_by_short_id function to include license_id in the return type
DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
 RETURNS TABLE(id uuid, emoji_combination text, fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, license_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, ''inactive'') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        fl.id as license_id
    FROM fanmarks f
    LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
        AND fl.status = ''active'' 
        AND fl.license_end > now()
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
    AND f.status = ''active'';
END;
$function$"}', 'b23f0afa-d9ca-4690-a8d9-7221c35b72c3', NULL, NULL, NULL),
	('20250927152936', '{"-- Fix get_public_emoji_profile function to work with RLS by making it SECURITY DEFINER
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid)","CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_license_id uuid)
 RETURNS TABLE(license_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''public''
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
$function$","-- Grant execute permissions to anon and authenticated users so they can access public profiles
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon","GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO authenticated"}', 'e39fe580-0fa8-482d-be70-13d7f261b774', NULL, NULL, NULL),
	('20251001220009', '{"-- Emergency fix: Update overdue grace licenses to expired status
-- This fixes licenses that should have transitioned to expired but didn''t

DO $$
DECLARE
  grace_days integer;
  affected_count integer;
BEGIN
  -- Get grace period from system settings
  SELECT CAST(setting_value AS integer) INTO grace_days
  FROM system_settings
  WHERE setting_key = ''grace_period_days'';

  -- Update grace licenses that have exceeded grace period
  WITH overdue_grace AS (
    SELECT id, license_end
    FROM fanmark_licenses
    WHERE status = ''grace''
      AND license_end + (grace_days || '' days'')::interval < NOW()
  )
  UPDATE fanmark_licenses
  SET 
    status = ''expired'',
    excluded_at = NOW(),
    updated_at = NOW()
  FROM overdue_grace
  WHERE fanmark_licenses.id = overdue_grace.id;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE ''Updated % overdue grace licenses to expired status'', affected_count;

  -- Fix expired licenses that are missing excluded_at
  UPDATE fanmark_licenses
  SET 
    excluded_at = COALESCE(excluded_at, updated_at, license_end),
    updated_at = NOW()
  WHERE status = ''expired''
    AND excluded_at IS NULL;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE ''Fixed % expired licenses with missing excluded_at'', affected_count;

  -- Delete configuration data for expired licenses
  DELETE FROM fanmark_basic_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = ''expired''
  );

  DELETE FROM fanmark_redirect_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = ''expired''
  );

  DELETE FROM fanmark_messageboard_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = ''expired''
  );

  DELETE FROM fanmark_password_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = ''expired''
  );

  RAISE NOTICE ''Cleaned up configuration data for expired licenses'';
END $$"}', 'cbd5dc33-454f-4074-bc03-02fa8fae4397', NULL, NULL, NULL),
	('20251002122249', '{"-- Remove Grace period editing permissions from RLS policies

-- 1. fanmark_basic_configs: Remove Grace period condition
DROP POLICY IF EXISTS \"Users can manage configs for their own licenses\" ON public.fanmark_basic_configs","CREATE POLICY \"Users can manage configs for their own licenses\"
ON public.fanmark_basic_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_basic_configs.license_id
      AND fl.user_id = auth.uid()
      AND fl.status = ''active''
      AND (fl.license_end IS NULL OR fl.license_end > now())
  )
)","-- 2. fanmark_redirect_configs: Remove Grace period condition
DROP POLICY IF EXISTS \"Users can manage redirect configs for their own licenses\" ON public.fanmark_redirect_configs","CREATE POLICY \"Users can manage redirect configs for their own licenses\"
ON public.fanmark_redirect_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_redirect_configs.license_id
      AND fl.user_id = auth.uid()
      AND fl.status = ''active''
      AND (fl.license_end IS NULL OR fl.license_end > now())
  )
)","-- 3. fanmark_messageboard_configs: Remove Grace period condition
DROP POLICY IF EXISTS \"Users can manage messageboard configs for their own licenses\" ON public.fanmark_messageboard_configs","CREATE POLICY \"Users can manage messageboard configs for their own licenses\"
ON public.fanmark_messageboard_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_messageboard_configs.license_id
      AND fl.user_id = auth.uid()
      AND fl.status = ''active''
      AND (fl.license_end IS NULL OR fl.license_end > now())
  )
)"}', 'f22b36fa-0cf3-4dda-b86b-4efee9c3b731', NULL, NULL, NULL),
	('20251003075614', '{"-- Backfill excluded_at for expired licenses that were manually returned
-- This ensures data consistency for licenses that were expired before excluded_at tracking was implemented

-- Update expired licenses that have no excluded_at but have future license_end
-- Use updated_at as the excluded_at value (represents when the license was actually returned)
UPDATE fanmark_licenses
SET excluded_at = updated_at
WHERE status = ''expired''
  AND excluded_at IS NULL
  AND license_end > now()"}', '589ad2fd-8bb5-40cb-9348-924f11629647', NULL, NULL, NULL),
	('20251027122009', '{"-- Add ''ko'' and ''id'' to user_language enum for internationalization support
-- Note: PostgreSQL enum values cannot be removed once added, only new values can be added

-- Add Korean language support
ALTER TYPE user_language ADD VALUE IF NOT EXISTS ''ko''","-- Add Indonesian language support  
ALTER TYPE user_language ADD VALUE IF NOT EXISTS ''id''"}', '870a3042-f995-4f5d-820b-faa82ed9e3f4', NULL, NULL, NULL),
	('20251003000724', '{"-- Update get_fanmark_details_by_short_id to include excluded_at in license_history
CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
 RETURNS TABLE(fanmark_id uuid, emoji_combination text, normalized_emoji text, short_id text, fanmark_created_at timestamp with time zone, current_license_id uuid, current_owner_username text, current_owner_display_name text, current_license_start timestamp with time zone, current_license_end timestamp with time zone, is_currently_active boolean, first_acquired_date timestamp with time zone, first_owner_username text, first_owner_display_name text, license_history jsonb, is_favorited boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  -- Get fanmark basic info
  SELECT f.id, f.emoji_combination, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = ''active'';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH current_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end,
      (fl.status = ''active'' AND fl.license_end > now()) as is_active
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
      AND fl.status = ''active'' 
      AND fl.license_end > now()
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''excluded_at'', fl.excluded_at,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.emoji_combination,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    cl.license_id,
    cl.username,
    cl.display_name,
    cl.license_start,
    cl.license_end,
    COALESCE(cl.is_active, false),
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, ''[]''::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM current_license cl
  CROSS JOIN first_license fl
  CROSS JOIN history h
  CROSS JOIN favorite_status fs;
END;
$function$"}', '64146d3b-9fca-43b9-8df8-86fc18263dff', NULL, NULL, NULL),
	('20251003012856', '{"-- Drop existing function first
DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text)","-- Refactor get_fanmark_details_by_short_id to use fanmarks-first LEFT JOIN approach
CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  fanmark_id uuid,
  emoji_combination text,
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  -- Get fanmark basic info
  SELECT f.id, f.emoji_combination, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = ''active'';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      fl.status,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''excluded_at'', fl.excluded_at,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.emoji_combination,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    CASE 
      WHEN ll.status IN (''active'', ''grace'') AND ll.license_end > now() 
      THEN true 
      ELSE false 
    END as is_currently_active,
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, ''[]''::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON true
  LEFT JOIN first_license fl ON true
  LEFT JOIN history h ON true
  LEFT JOIN favorite_status fs ON true;
END;
$function$"}', '5ab2bcc1-f161-4310-bcd6-0da95f92e8be', NULL, NULL, NULL),
	('20251003042840', '{"-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions","CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions","-- Update existing grace licenses that have exceeded grace period to expired
DO $$
DECLARE
  grace_period_days_value INTEGER;
  grace_period_ms BIGINT;
BEGIN
  -- Get grace period setting
  SELECT setting_value::INTEGER INTO grace_period_days_value
  FROM public.system_settings
  WHERE setting_key = ''grace_period_days'';
  
  -- Default to 7 days if not set
  IF grace_period_days_value IS NULL THEN
    grace_period_days_value := 7;
  END IF;
  
  grace_period_ms := grace_period_days_value * 24 * 60 * 60 * 1000;
  
  -- Update licenses that are in grace status and have exceeded grace period
  WITH expired_licenses AS (
    SELECT fl.id, fl.fanmark_id
    FROM public.fanmark_licenses fl
    WHERE fl.status = ''grace''
    AND EXTRACT(EPOCH FROM (now() - fl.license_end)) * 1000 > grace_period_ms
  )
  UPDATE public.fanmark_licenses fl
  SET 
    status = ''expired'',
    excluded_at = now(),
    updated_at = now()
  FROM expired_licenses el
  WHERE fl.id = el.id;
  
  -- Delete associated configurations for expired licenses
  DELETE FROM public.fanmark_basic_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = ''expired'' AND excluded_at IS NOT NULL
  );
  
  DELETE FROM public.fanmark_redirect_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = ''expired'' AND excluded_at IS NOT NULL
  );
  
  DELETE FROM public.fanmark_messageboard_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = ''expired'' AND excluded_at IS NOT NULL
  );
  
  DELETE FROM public.fanmark_password_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = ''expired'' AND excluded_at IS NOT NULL
  );
END $$","-- Schedule cron job to run check-expired-licenses function daily at 2 AM UTC
SELECT cron.schedule(
  ''check-expired-licenses-daily'',
  ''0 2 * * *'', -- Every day at 2:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := ''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses'',
      headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''Authorization'', ''Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o''
      ),
      body := jsonb_build_object(''scheduled'', true)
    ) as request_id;
  $$
)"}', '54c793d8-b777-410b-b0f0-0a63c1bacfd0', NULL, NULL, NULL),
	('20251003043249', '{"-- Remove existing cron job
SELECT cron.unschedule(''check-expired-licenses-daily'')","-- Reschedule cron job to run daily at midnight UTC
SELECT cron.schedule(
  ''check-expired-licenses-daily'',
  ''0 0 * * *'', -- Every day at midnight UTC
  $$
  SELECT
    net.http_post(
      url := ''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses'',
      headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''Authorization'', ''Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o''
      ),
      body := jsonb_build_object(''scheduled'', true)
    ) as request_id;
  $$
)"}', '7671cb33-ba8d-402d-8a71-06e97a91c781', NULL, NULL, NULL),
	('20251003081829', '{"-- Add grace_expires_at column to fanmark_licenses table
ALTER TABLE fanmark_licenses 
ADD COLUMN grace_expires_at TIMESTAMP WITH TIME ZONE","-- Backfill existing grace licenses
-- Calculate grace_expires_at as license_end + grace_period_days
UPDATE fanmark_licenses fl
SET grace_expires_at = fl.license_end + (
  SELECT CAST(setting_value AS INTEGER) * INTERVAL ''1 day''
  FROM system_settings 
  WHERE setting_key = ''grace_period_days''
)
WHERE fl.status = ''grace'' AND fl.grace_expires_at IS NULL","-- Backfill existing expired licenses (for historical reference)
-- Calculate grace_expires_at as license_end + grace_period_days
UPDATE fanmark_licenses fl
SET grace_expires_at = fl.license_end + (
  SELECT CAST(setting_value AS INTEGER) * INTERVAL ''1 day''
  FROM system_settings 
  WHERE setting_key = ''grace_period_days''
)
WHERE fl.status = ''expired'' AND fl.grace_expires_at IS NULL","-- Add index for grace expiration queries (performance optimization)
CREATE INDEX idx_fanmark_licenses_grace_expires 
ON fanmark_licenses(grace_expires_at) 
WHERE status = ''grace''","-- Add index for grace re-acquisition check
CREATE INDEX idx_fanmark_licenses_fanmark_grace 
ON fanmark_licenses(fanmark_id, status, grace_expires_at)
WHERE status IN (''active'', ''grace'')"}', '3e76b775-c37a-43b9-bc11-206fb817851b', NULL, NULL, NULL),
	('20251011075335', '{"-- ============================================
-- セキュリティ強化: 価格情報の非公開化
-- ============================================

-- 1. 価格情報とビジネスルールを非公開に設定
UPDATE system_settings 
SET is_public = false 
WHERE setting_key IN (
  ''premium_pricing'',
  ''business_pricing'', 
  ''enterprise_pricing'',
  ''creator_fanmarks_limit'',
  ''business_fanmarks_limit'',
  ''enterprise_fanmarks_limit'',
  ''max_fanmarks_per_user''
)","-- 2. 管理者用RLSポリシーの追加
CREATE POLICY \"Admins can view all settings\"
ON system_settings
FOR SELECT
TO authenticated
USING (is_admin())","CREATE POLICY \"Admins can update all settings\"  
ON system_settings
FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin())","-- 3. ファンマークプロフィールのセキュリティ強化
DROP POLICY IF EXISTS \"Users can view public profiles or their own profiles\" ON fanmark_profiles","CREATE POLICY \"Authenticated users can view public profiles or own\"
ON fanmark_profiles
FOR SELECT
TO authenticated
USING (
  is_public = true 
  OR EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
)"}', 'c82c6d81-2788-4297-ac8b-172d51227342', NULL, NULL, NULL),
	('20251003092453', '{"-- Drop and recreate get_fanmark_details_by_short_id with grace_expires_at support
DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
 RETURNS TABLE(
   fanmark_id uuid,
   emoji_combination text,
   normalized_emoji text,
   short_id text,
   fanmark_created_at timestamp with time zone,
   current_license_id uuid,
   current_owner_username text,
   current_owner_display_name text,
   current_license_start timestamp with time zone,
   current_license_end timestamp with time zone,
   current_license_status text,
   current_grace_expires_at timestamp with time zone,
   is_currently_active boolean,
   first_acquired_date timestamp with time zone,
   first_owner_username text,
   first_owner_display_name text,
   license_history jsonb,
   is_favorited boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  -- Get fanmark basic info
  SELECT f.id, f.emoji_combination, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = ''active'';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''grace_expires_at'', fl.grace_expires_at,
          ''excluded_at'', fl.excluded_at,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.emoji_combination,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    CASE 
      WHEN ll.status = ''active'' AND ll.license_end > now() 
      THEN true 
      ELSE false 
    END as is_currently_active,
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, ''[]''::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON true
  LEFT JOIN first_license fl ON true
  LEFT JOIN history h ON true
  LEFT JOIN favorite_status fs ON true;
END;
$function$"}', '7da8109e-7892-4826-bb60-2563fb7546a0', NULL, NULL, NULL),
	('20251003234601', '{"-- Fix fanmark_profiles RLS to enforce is_public flag

-- Drop existing policy that allows all operations for owners
DROP POLICY IF EXISTS \"Users can manage their own fanmark profiles\" ON public.fanmark_profiles","-- Create separate policies for different operations

-- SELECT policy: Allow viewing public profiles OR own profiles (public or private)
CREATE POLICY \"Users can view public profiles or their own profiles\"
ON public.fanmark_profiles
FOR SELECT
USING (
  is_public = true 
  OR 
  EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
)","-- INSERT policy: Users can create profiles for their own active licenses
CREATE POLICY \"Users can create profiles for their own licenses\"
ON public.fanmark_profiles
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
      AND fl.status = ''active'' 
      AND fl.license_end > now()
  )
)","-- UPDATE policy: Users can update their own profiles
CREATE POLICY \"Users can update their own profiles\"
ON public.fanmark_profiles
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
)","-- DELETE policy: Users can delete their own profiles
CREATE POLICY \"Users can delete their own profiles\"
ON public.fanmark_profiles
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
)"}', '5f1466d3-64b1-47c3-b852-a78cf5bb72df', NULL, NULL, NULL),
	('20251004120000', '{"-- Ensure usernames are automatically generated in the format userXXXXXXXXXX
CREATE SEQUENCE IF NOT EXISTS public.user_username_seq","-- Helper function to generate the next available numeric username
CREATE OR REPLACE FUNCTION public.generate_numeric_username()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := ''user'' || lpad(nextval(''public.user_username_seq'')::text, 10, ''0'');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.user_settings WHERE username = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$","-- Align the sequence with the current highest numeric username, if any exist
DO $$
DECLARE
  max_suffix bigint;
BEGIN
  SELECT MAX((regexp_matches(username, ''^user(\\\\d+)$''))[1]::bigint)
    INTO max_suffix
  FROM public.user_settings
  WHERE username ~ ''^user\\\\d+$'';

  IF max_suffix IS NULL THEN
    PERFORM setval(''public.user_username_seq'', 0, false);
  ELSE
    PERFORM setval(''public.user_username_seq'', max_suffix, true);
  END IF;
END;
$$","-- Update new user handler to always use the generated username
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
    public.generate_numeric_username(),
    COALESCE(
      NEW.raw_user_meta_data ->> ''display_name'',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    ''free'',
    COALESCE(NEW.raw_user_meta_data ->> ''preferred_language'', ''en'')::user_language
  );
  RETURN NEW;
END;
$$"}', 'auto_numeric_usernames', NULL, NULL, NULL),
	('20251007065031', '{"-- Update get_fanmark_by_short_id to include short_id and license return status
DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
RETURNS TABLE (
    id uuid,
    short_id text,
    emoji_combination text,
    fanmark_name text,
    access_type text,
    target_url text,
    text_content text,
    status text,
    is_password_protected boolean,
    license_id uuid,
    license_status text,
    license_end timestamptz,
    grace_expires_at timestamptz,
    is_returned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.short_id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) AS fanmark_name,
        COALESCE(bc.access_type, ''inactive'') AS access_type,
        rc.target_url,
        mc.content AS text_content,
        f.status,
        COALESCE(pc.is_enabled, false) AS is_password_protected,
        fl.id AS license_id,
        fl.status AS license_status,
        fl.license_end,
        fl.grace_expires_at,
        fl.is_returned
    FROM fanmarks f
    LEFT JOIN LATERAL (
        SELECT fl_inner.*
        FROM fanmark_licenses fl_inner
        WHERE fl_inner.fanmark_id = f.id
          AND fl_inner.status IN (''active'', ''grace'')
        ORDER BY fl_inner.license_end DESC NULLS LAST
        LIMIT 1
    ) fl ON TRUE
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
      AND f.status = ''active'';
END;
$function$"}', 'update_get_fanmark_by_short_id', NULL, NULL, NULL),
	('20251012024650', '{"-- Create a secure function to check username availability
-- This prevents direct access to other users'' data while allowing username uniqueness checks
CREATE OR REPLACE FUNCTION public.check_username_availability_secure(
  username_to_check text,
  current_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Return false if username is empty
  IF username_to_check IS NULL OR username_to_check = '''' THEN
    RETURN false;
  END IF;
  
  -- Check if username exists for a different user
  RETURN NOT EXISTS (
    SELECT 1 
    FROM public.user_settings
    WHERE username = lower(username_to_check)
      AND user_id != COALESCE(current_user_id, ''00000000-0000-0000-0000-000000000000''::uuid)
  );
END;
$$","-- Add comment explaining the function''s purpose
COMMENT ON FUNCTION public.check_username_availability_secure IS 
''Securely checks if a username is available without exposing other users data. Returns true if available, false if taken.''"}', 'b31f8288-6b3a-4a78-be17-9128860c3ef5', NULL, NULL, NULL),
	('20251012031101', '{"-- ====================================
-- Fix 1: Separate user roles from plan types
-- ====================================

-- Create enum for application roles
CREATE TYPE public.app_role AS ENUM (''admin'', ''moderator'', ''user'')","-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (user_id, role)
)","-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY","-- RLS policy: Admins can manage roles
CREATE POLICY \"Admins can manage all user roles\"
ON public.user_roles
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ''admin''
  )
)","-- RLS policy: Users can view their own roles
CREATE POLICY \"Users can view their own roles\"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id)","-- Create security definer function to check roles
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
$$","-- Migrate existing admin users from plan_type to roles
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, ''admin''::app_role
FROM public.user_settings
WHERE plan_type = ''admin''
ON CONFLICT (user_id, role) DO NOTHING","-- Update is_admin() function to use new role system
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

  RETURN public.has_role(current_user_id, ''admin'');
END;
$$","-- Update is_super_admin() function to use new role system
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
  is_admin_user := public.has_role(current_user_id, ''admin'');

  IF NOT is_admin_user THEN
    RETURN FALSE;
  END IF;

  -- Require a recent session within the last 4 hours
  SELECT EXISTS(
    SELECT 1
    FROM auth.sessions s
    WHERE s.user_id = current_user_id
      AND s.created_at > now() - INTERVAL ''4 hours''
      AND COALESCE(s.aal, '''') <> ''''
  )
  INTO has_recent_session;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    current_user_id,
    ''ADMIN_CHECK'',
    ''system'',
    jsonb_build_object(
      ''timestamp'', now(),
      ''session_valid'', has_recent_session,
      ''admin_check_result'', has_recent_session
    )
  );

  RETURN has_recent_session;
END;
$$","-- ====================================
-- Fix 2: Add public read access to emoji_master
-- ====================================

-- Allow authenticated users to view emoji catalog
CREATE POLICY \"Authenticated users can view emoji catalog\"
ON public.emoji_master
FOR SELECT
TO authenticated
USING (true)","-- Add audit logging for admin actions on emoji_master
CREATE OR REPLACE FUNCTION public.log_emoji_master_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = ''DELETE'' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''EMOJI_MASTER_DELETE'',
      ''emoji_master'',
      OLD.id::text,
      jsonb_build_object(''emoji'', OLD.emoji, ''short_name'', OLD.short_name)
    );
    RETURN OLD;
  ELSIF TG_OP = ''UPDATE'' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''EMOJI_MASTER_UPDATE'',
      ''emoji_master'',
      NEW.id::text,
      jsonb_build_object(''emoji'', NEW.emoji, ''short_name'', NEW.short_name)
    );
    RETURN NEW;
  ELSIF TG_OP = ''INSERT'' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      ''EMOJI_MASTER_INSERT'',
      ''emoji_master'',
      NEW.id::text,
      jsonb_build_object(''emoji'', NEW.emoji, ''short_name'', NEW.short_name)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$","CREATE TRIGGER audit_emoji_master_changes
AFTER INSERT OR UPDATE OR DELETE ON public.emoji_master
FOR EACH ROW
EXECUTE FUNCTION public.log_emoji_master_changes()"}', '71504db1-16f1-4b4d-b5e4-0a14f9c117be', NULL, NULL, NULL),
	('20251013070936', '{"-- Add admin policies for fanmark_tier_extension_prices table
-- This allows admins to view and update tier extension prices from the admin dashboard

-- Drop existing policies if they exist
DROP POLICY IF EXISTS \"Allow admin read all extension prices\" ON public.fanmark_tier_extension_prices","DROP POLICY IF EXISTS \"Allow admin update extension prices\" ON public.fanmark_tier_extension_prices","-- Create policy for admins to read all extension prices (including inactive ones)
CREATE POLICY \"Allow admin read all extension prices\"
ON public.fanmark_tier_extension_prices
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.is_admin = true
  )
)","-- Create policy for admins to update extension prices
CREATE POLICY \"Allow admin update extension prices\"
ON public.fanmark_tier_extension_prices
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.is_admin = true
  )
)","-- Note: The existing policy \"Allow authenticated read extension prices\"
-- remains in place for non-admin users to read active prices"}', 'add_admin_policies_for_tier_extension_prices', NULL, NULL, NULL),
	('20251019120000', '{"-- Relax aal check to avoid invalid enum errors and accept sessions with NULL aal
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  has_recent_session boolean := false;
  is_admin_user boolean := false;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT true
  INTO is_admin_user
  FROM public.user_settings us
  WHERE us.user_id = current_user_id
    AND us.plan_type = ''admin''
  LIMIT 1;

  IF NOT is_admin_user THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM auth.sessions s
    WHERE s.user_id = current_user_id
      AND s.created_at > now() - interval ''4 hours''
  )
  INTO has_recent_session;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    current_user_id,
    ''ADMIN_CHECK'',
    ''system'',
    jsonb_build_object(
      ''timestamp'', now(),
      ''session_valid'', has_recent_session,
      ''admin_check_result'', has_recent_session
    )
  );

  RETURN has_recent_session;
END;
$$","COMMENT ON FUNCTION public.is_super_admin IS
''Additional guard for critical operations. Requires admin plan and a recent valid session.''"}', 'update_is_super_admin', NULL, NULL, NULL),
	('20251020031322', '{"-- Phase 5: Initial notification templates and rules

-- Insert notification templates (Japanese and English)

-- Template: license_grace_started (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  ''ja'',
  ''in_app'',
  ''ライセンス猶予期間開始'',
  ''ファンマーク「{{fanmark_name}}」のライセンスが猶予期間に入りました。{{grace_expires_at}}までに更新してください。'',
  ''ライセンス更新が必要です'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"license_end\", \"grace_expires_at\"]}''::jsonb,
  true
)","-- Template: license_grace_started (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND body LIKE ''%猶予期間%'' LIMIT 1),
  1,
  ''en'',
  ''in_app'',
  ''License Grace Period Started'',
  ''Your fanmark \"{{fanmark_name}}\" license has entered the grace period. Please renew by {{grace_expires_at}}.'',
  ''License renewal required'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"license_end\", \"grace_expires_at\"]}''::jsonb,
  true
)","-- Template: license_expired (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  ''ja'',
  ''in_app'',
  ''ライセンス失効'',
  ''ファンマーク「{{fanmark_name}}」のライセンスが失効しました。再度取得することができます。'',
  ''ライセンスが失効しました'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"expired_at\", \"license_end\"]}''::jsonb,
  true
)","-- Template: license_expired (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND body LIKE ''%失効しました%'' LIMIT 1),
  1,
  ''en'',
  ''in_app'',
  ''License Expired'',
  ''Your fanmark \"{{fanmark_name}}\" license has expired. You can acquire it again.'',
  ''License has expired'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"expired_at\", \"license_end\"]}''::jsonb,
  true
)","-- Template: favorite_fanmark_available (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  ''ja'',
  ''in_app'',
  ''お気に入りファンマークが利用可能'',
  ''お気に入りのファンマーク「{{fanmark_name}}」が再び利用可能になりました。'',
  ''取得チャンスです'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\"]}''::jsonb,
  true
)","-- Template: favorite_fanmark_available (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND body LIKE ''%再び利用可能%'' LIMIT 1),
  1,
  ''en'',
  ''in_app'',
  ''Favorite Fanmark Available'',
  ''Your favorite fanmark \"{{fanmark_name}}\" is now available again.'',
  ''Acquisition opportunity'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\"]}''::jsonb,
  true
)","-- Insert notification rules

-- Rule: license_grace_started -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  ''license_grace_started'',
  ''in_app'',
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND body LIKE ''%猶予期間%'' LIMIT 1),
  1,
  8,
  0,
  true,
  NULL,
  NULL
)","-- Rule: license_expired -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  ''license_expired'',
  ''in_app'',
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND body LIKE ''%失効しました%'' LIMIT 1),
  1,
  7,
  0,
  true,
  NULL,
  NULL
)","-- Rule: favorite_fanmark_available -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  ''favorite_fanmark_available'',
  ''in_app'',
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND body LIKE ''%再び利用可能%'' LIMIT 1),
  1,
  6,
  0,
  true,
  1,
  86400
)"}', '46d09534-4c9a-4808-b94f-82a47007b0f4', NULL, NULL, NULL),
	('20251020031926', '{"-- Phase 7: Cron設定 - 通知イベント処理を毎分実行

-- pg_cron拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS pg_cron","-- pg_net拡張機能を有効化（HTTP呼び出しに必要）
CREATE EXTENSION IF NOT EXISTS pg_net","-- 既存のCronジョブを削除（存在する場合）
SELECT cron.unschedule(''process-notification-events-every-minute'') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = ''process-notification-events-every-minute''
)","-- 通知イベント処理を毎分実行するCronジョブを作成
SELECT cron.schedule(
  ''process-notification-events-every-minute'',
  ''* * * * *'', -- 毎分実行
  $$
  SELECT
    net.http_post(
        url:=''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/process-notification-events'',
        headers:=''{\"Content-Type\": \"application/json\", \"Authorization\": \"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o\"}''::jsonb,
        body:=concat(''{\"timestamp\": \"'', now(), ''\"}'')::jsonb
    ) as request_id;
  $$
)"}', '8d76ec9d-b4b0-493f-b6c7-d15b044584ec', NULL, NULL, NULL),
	('20251027122744', '{"-- ============================================
-- 抽選システム: テーブル作成とRLSポリシー
-- ============================================

-- 抽選申込テーブル
CREATE TABLE public.fanmark_lottery_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id UUID NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  license_id UUID NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  lottery_probability NUMERIC NOT NULL DEFAULT 1.0,
  entry_status TEXT NOT NULL DEFAULT ''pending'',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lottery_executed_at TIMESTAMPTZ,
  won_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_fanmark_user_license UNIQUE (fanmark_id, user_id, license_id),
  CONSTRAINT valid_entry_status CHECK (entry_status IN (''pending'', ''won'', ''lost'', ''cancelled'', ''cancelled_by_extension'')),
  CONSTRAINT valid_cancellation_reason CHECK (cancellation_reason IS NULL OR cancellation_reason IN (''user_request'', ''license_extended'', ''system'')),
  CONSTRAINT positive_probability CHECK (lottery_probability > 0)
)","-- インデックス作成
CREATE INDEX idx_lottery_entries_fanmark_status ON public.fanmark_lottery_entries(fanmark_id, entry_status)","CREATE INDEX idx_lottery_entries_user_status ON public.fanmark_lottery_entries(user_id, entry_status)","CREATE INDEX idx_lottery_entries_license_status ON public.fanmark_lottery_entries(license_id, entry_status)","-- 抽選履歴テーブル
CREATE TABLE public.fanmark_lottery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id UUID NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  license_id UUID NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  total_entries INTEGER NOT NULL,
  winner_user_id UUID,
  winner_entry_id UUID REFERENCES public.fanmark_lottery_entries(id),
  probability_distribution JSONB NOT NULL DEFAULT ''[]''::jsonb,
  random_seed TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_method TEXT NOT NULL DEFAULT ''automatic'',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_execution_method CHECK (execution_method IN (''automatic'', ''manual''))
)","-- インデックス作成
CREATE INDEX idx_lottery_history_fanmark ON public.fanmark_lottery_history(fanmark_id)","CREATE INDEX idx_lottery_history_executed_at ON public.fanmark_lottery_history(executed_at DESC)","-- RLS有効化
ALTER TABLE public.fanmark_lottery_entries ENABLE ROW LEVEL SECURITY","ALTER TABLE public.fanmark_lottery_history ENABLE ROW LEVEL SECURITY","-- ============================================
-- RLSポリシー: fanmark_lottery_entries
-- ============================================

-- ユーザーは自分のエントリーのみ閲覧可
CREATE POLICY \"Users can view their own entries\"
  ON public.fanmark_lottery_entries
  FOR SELECT
  USING (auth.uid() = user_id)","-- ユーザーはGrace期間中のライセンスに申込可能
CREATE POLICY \"Users can create entries for grace licenses\"
  ON public.fanmark_lottery_entries
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.fanmark_licenses fl
      WHERE fl.id = license_id
        AND fl.status = ''grace''
        AND fl.grace_expires_at > now()
        AND fl.user_id != auth.uid()
    )
  )","-- ユーザーは自分のpendingエントリーのみキャンセル可
CREATE POLICY \"Users can cancel their pending entries\"
  ON public.fanmark_lottery_entries
  FOR UPDATE
  USING (auth.uid() = user_id AND entry_status = ''pending'')
  WITH CHECK (entry_status IN (''cancelled'', ''pending''))","-- 管理者はすべてのエントリーを管理可能
CREATE POLICY \"Admins can manage all lottery entries\"
  ON public.fanmark_lottery_entries
  FOR ALL
  USING (is_admin())","-- ============================================
-- RLSポリシー: fanmark_lottery_history
-- ============================================

-- 管理者のみ抽選履歴を閲覧可能
CREATE POLICY \"Admins can view lottery history\"
  ON public.fanmark_lottery_history
  FOR SELECT
  USING (is_admin())","-- システムのみ履歴を作成可能（Edge Functionから）
CREATE POLICY \"System can create lottery history\"
  ON public.fanmark_lottery_history
  FOR INSERT
  WITH CHECK (auth.role() = ''service_role'')","-- ============================================
-- トリガー: updated_at自動更新
-- ============================================

CREATE TRIGGER update_lottery_entries_updated_at
  BEFORE UPDATE ON public.fanmark_lottery_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column()","-- ============================================
-- 監査ログトリガー
-- ============================================

CREATE OR REPLACE FUNCTION public.log_lottery_entry_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $$
BEGIN
  IF TG_OP = ''INSERT'' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      ''LOTTERY_ENTRY_CREATED'',
      ''fanmark_lottery_entry'',
      NEW.id::text,
      jsonb_build_object(
        ''fanmark_id'', NEW.fanmark_id,
        ''license_id'', NEW.license_id,
        ''lottery_probability'', NEW.lottery_probability
      )
    );
  ELSIF TG_OP = ''UPDATE'' AND OLD.entry_status != NEW.entry_status THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      ''LOTTERY_ENTRY_STATUS_CHANGED'',
      ''fanmark_lottery_entry'',
      NEW.id::text,
      jsonb_build_object(
        ''old_status'', OLD.entry_status,
        ''new_status'', NEW.entry_status,
        ''cancellation_reason'', NEW.cancellation_reason
      )
    );
  END IF;
  RETURN NEW;
END;
$$","CREATE TRIGGER audit_lottery_entry_changes
  AFTER INSERT OR UPDATE ON public.fanmark_lottery_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.log_lottery_entry_changes()"}', 'fdc124f3-1579-4363-ac9d-4740a1e52c4d', NULL, NULL, NULL),
	('20251028225135', '{"-- Phase 1: Extend get_fanmark_complete_data to include lottery information
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[])","CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL,
  emoji_ids_param uuid[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  access_type text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  fanmark_name text,
  target_url text,
  text_content text,
  is_password_protected boolean,
  current_owner_id uuid,
  license_end timestamptz,
  has_active_license boolean,
  license_id uuid,
  current_license_status text,
  current_grace_expires_at timestamptz,
  is_blocked_for_registration boolean,
  next_available_at timestamptz,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '''' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    latest.user_id AS current_owner_id,
    latest.license_end,
    CASE
      WHEN latest.status = ''active'' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      ELSE false
    END AS has_active_license,
    latest.id AS license_id,
    latest.status AS current_license_status,
    latest.grace_expires_at AS current_grace_expires_at,
    CASE
      WHEN latest.status = ''active'' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      WHEN latest.status = ''grace'' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN true
      ELSE false
    END AS is_blocked_for_registration,
    CASE
      WHEN latest.status = ''grace'' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN COALESCE(latest.grace_expires_at, latest.license_end)
      WHEN latest.status = ''active'' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN latest.license_end
      ELSE NULL
    END AS next_available_at,
    COALESCE(lottery_info.entry_count, 0) AS lottery_entry_count,
    COALESCE(lottery_info.has_entry, false) AS has_user_lottery_entry,
    lottery_info.user_entry_id AS user_lottery_entry_id
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl.*
    FROM fanmark_licenses fl
    WHERE fl.fanmark_id = f.id
    ORDER BY (fl.license_end IS NULL) DESC, fl.license_end DESC
    LIMIT 1
  ) AS latest ON true
  LEFT JOIN fanmark_basic_configs bc ON latest.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON latest.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON latest.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON latest.id = pc.license_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id FROM fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = f.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = ''pending'' 
       LIMIT 1) AS user_entry_id
    FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id
      AND fle.entry_status = ''pending''
  ) AS lottery_info ON true
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$","-- Phase 1.2: Create new RPC function for search with lottery information
CREATE OR REPLACE FUNCTION public.search_fanmarks_with_lottery(input_emoji_ids uuid[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
  lottery_entry_count bigint := 0;
  has_user_lottery_entry boolean := false;
  user_lottery_entry_id uuid := NULL;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_emoji_ids'');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''tier_display_name'', tier_info.display_name,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days,
        ''lottery_entry_count'', 0,
        ''has_user_lottery_entry'', false,
        ''user_lottery_entry_id'', NULL
      );
    ELSE
      RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  END IF;

  -- Get lottery information
  SELECT
    COUNT(*),
    BOOL_OR(fle.user_id = current_user_id),
    (SELECT fle2.id FROM fanmark_lottery_entries fle2 
     WHERE fle2.fanmark_id = fanmark_record.id 
       AND fle2.user_id = current_user_id 
       AND fle2.entry_status = ''pending'' 
     LIMIT 1)
  INTO lottery_entry_count, has_user_lottery_entry, user_lottery_entry_id
  FROM fanmark_lottery_entries fle
  WHERE fle.fanmark_id = fanmark_record.id
    AND fle.entry_status = ''pending'';

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = ''grace'' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = ''active'' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = ''grace'' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = ''grace'' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = ''grace'' THEN ''grace_period''
      ELSE ''taken''
    END;
  END IF;

  RETURN json_build_object(
    ''available'', is_available,
    ''fanmark_id'', fanmark_record.id,
    ''reason'', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    ''available_at'', available_at,
    ''blocking_status'', blocking_status,
    ''lottery_entry_count'', lottery_entry_count,
    ''has_user_lottery_entry'', has_user_lottery_entry,
    ''user_lottery_entry_id'', user_lottery_entry_id
  );
END;
$function$"}', 'ac0cc342-0a3e-4a0c-a221-7e04dc436056', NULL, NULL, NULL),
	('20251212013954', '{"-- Remove the public access policy that exposes user_id
-- The \"recent fanmarks\" feature uses the list_recent_fanmarks() SECURITY DEFINER function
-- which doesn''t expose user_id, so this change won''t break that feature
DROP POLICY IF EXISTS \"Anyone can view active fanmark licenses for recent activity\" ON public.fanmark_licenses"}', '0a22a59c-6f97-40bc-9298-0f3fe10de618', NULL, NULL, NULL),
	('20251020130920', '{"-- Fix notification_events.source constraint
ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_source_check","ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_source_check 
  CHECK (source IN (''system'', ''cron_job'', ''edge_function'', ''admin_ui'', ''admin_manual'', ''batch''))","-- Fix notification_events.status constraint
ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_status_check","ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_status_check 
  CHECK (status IN (''pending'', ''processing'', ''processed'', ''failed'', ''skipped''))","-- Update any existing ''error'' status to ''failed''
UPDATE public.notification_events SET status = ''failed'' WHERE status = ''error''","-- Fix notifications.status constraint to include ''delivered''
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_status_check","ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check 
  CHECK (status IN (''pending'', ''delivered'', ''failed'', ''cancelled'', ''sending'', ''sent''))","-- Add RLS policy for admins to view all notifications
CREATE POLICY \"Admins can view all notifications\" 
  ON public.notifications 
  FOR SELECT 
  USING (public.is_admin())","-- Unschedule the hardcoded cron job
SELECT cron.unschedule(''process-notification-events-every-minute'') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = ''process-notification-events-every-minute''
)"}', '4a549412-98c5-4435-ac60-50dab6e207c0', NULL, NULL, NULL),
	('20251020233346', '{"-- ========================================
-- Cron Job Cleanup Migration
-- ========================================
-- 目的: マイグレーション内にハードコードされたCronジョブを削除し、
--       Supabase CLI ベースのスケジューリングに移行する
-- 
-- 実行日: 2025-10-20
-- 影響: 既存のpg_cronジョブをすべて削除（ダッシュボード/CLIで再設定が必要）
-- ========================================

-- 既存のCronジョブを安全に削除
SELECT cron.unschedule(''check-expired-licenses-daily'') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = ''check-expired-licenses-daily''
)","SELECT cron.unschedule(''process-notification-events-every-minute'') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = ''process-notification-events-every-minute''
)","-- ========================================
-- 注意事項
-- ========================================
-- 1. このマイグレーション実行後、Cronジョブは停止します
-- 2. 以下のいずれかの方法で再設定してください：
--    A) Supabase CLI: supabase functions schedule (推奨)
--       supabase functions schedule check-expired-licenses \"0 15 * * *\"
--       supabase functions schedule process-notification-events \"* * * * *\"
--    B) Supabase Dashboard: Database > Cron Jobs
-- 
-- 3. pg_cron/pg_net拡張機能は削除しません（他用途で使用可能性あり）
-- 
-- 4. 既存のJWTトークンは漏洩している可能性があるため、
--    再設定後にSupabaseダッシュボードでローテーションしてください
--    https://app.supabase.com/project/ppqgtbjykitqtiaisyji/settings/api
-- ========================================"}', '14d53ec8-4779-4fad-bde0-e86a30a289cc', NULL, NULL, NULL),
	('20251027230722', '{"-- Phase 1: RLSポリシー修正 - 現オーナーも抽選申込可能に

-- 既存のポリシーを削除
DROP POLICY IF EXISTS \"Users can create entries for grace licenses\" ON public.fanmark_lottery_entries","-- 新しいポリシーを作成（現オーナーのチェックを削除）
CREATE POLICY \"Users can create entries for grace licenses\"
  ON public.fanmark_lottery_entries
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.fanmark_licenses fl
      WHERE fl.id = license_id
        AND fl.status = ''grace''
        AND fl.grace_expires_at > now()
    )
  )"}', '52366274-0be8-4f10-bebf-7c6ac4435586', NULL, NULL, NULL),
	('20251030015005', '{"-- Drop and recreate get_fanmark_details_by_short_id with lottery information
DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  fanmark_id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  current_is_returned boolean,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid,
  current_owner_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
    INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param
    AND f.status = ''active'';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id AS license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      fl.is_returned,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start AS first_date,
      us.username AS first_username,
      us.display_name AS first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''grace_expires_at'', fl.grace_expires_at,
          ''excluded_at'', fl.excluded_at,
          ''is_returned'', fl.is_returned,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) AS history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.fanmark_favorites ff
      WHERE ff.fanmark_id = fanmark_record.id
        AND ff.user_id = current_user_id
    ) AS is_fav
  ),
  lottery_info AS (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id 
       FROM public.fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = fanmark_record.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = ''pending'' 
       LIMIT 1) AS user_entry_id
    FROM public.fanmark_lottery_entries fle
    WHERE fle.fanmark_id = fanmark_record.id
      AND fle.entry_status = ''pending''
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,

    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    ll.is_returned,
    CASE WHEN ll.status = ''active'' AND ll.license_end > now() THEN true ELSE false END AS is_currently_active,

    fl.first_date,
    fl.first_username,
    fl.first_display_name,

    COALESCE(h.history_data, ''[]''::jsonb),
    COALESCE(fs.is_fav, false),
    
    COALESCE(li.entry_count, 0)::bigint,
    COALESCE(li.has_entry, false),
    li.user_entry_id,
    ll.user_id
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE
  LEFT JOIN lottery_info li ON TRUE;
END;
$function$"}', '383857c4-457c-49ea-954e-d27b432f8a54', NULL, NULL, NULL),
	('20251031023917', '{"-- Add lottery fields back to get_fanmark_details_by_short_id function
DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  fanmark_id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  current_is_returned boolean,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid,
  current_owner_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
    INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param
    AND f.status = ''active'';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id AS license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      fl.is_returned,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start AS first_date,
      us.username AS first_username,
      us.display_name AS first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''grace_expires_at'', fl.grace_expires_at,
          ''excluded_at'', fl.excluded_at,
          ''is_returned'', fl.is_returned,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) AS history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.fanmark_favorites ff
      WHERE ff.fanmark_id = fanmark_record.id
        AND ff.user_id = current_user_id
    ) AS is_fav
  ),
  lottery_info AS (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id 
       FROM public.fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = fanmark_record.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = ''pending'' 
       LIMIT 1) AS user_entry_id
    FROM public.fanmark_lottery_entries fle
    WHERE fle.fanmark_id = fanmark_record.id
      AND fle.entry_status = ''pending''
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,

    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    ll.is_returned,
    CASE WHEN ll.status = ''active'' AND ll.license_end > now() THEN true ELSE false END AS is_currently_active,

    fl.first_date,
    fl.first_username,
    fl.first_display_name,

    COALESCE(h.history_data, ''[]''::jsonb),
    COALESCE(fs.is_fav, false),
    
    COALESCE(li.entry_count, 0)::bigint,
    COALESCE(li.has_entry, false),
    li.user_entry_id,
    ll.user_id
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE
  LEFT JOIN lottery_info li ON TRUE;
END;
$function$"}', '1c0d5045-ddbf-407e-b67b-e33c2b7c5637', NULL, NULL, NULL),
	('20251031040856', '{"-- Fix cron job to include Authorization header
-- Drop existing job
SELECT cron.unschedule(''check-expired-licenses-daily'')","-- Recreate with proper Authorization header
SELECT cron.schedule(
  ''check-expired-licenses-daily'',
  ''0 15 * * *'', -- Daily at 15:00 UTC (00:00 JST)
  $$
  SELECT net.http_post(
    url := ''https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o''
    ),
    body := jsonb_build_object(''scheduled'', true)
  );
  $$
)"}', 'b0cb8f61-2701-45f1-b5e5-b305450ce03a', NULL, NULL, NULL),
	('20251101090000', '{"-- Move the fanmark availability check to emoji ID based lookups

DROP FUNCTION IF EXISTS public.check_fanmark_availability_secure(text)","DROP FUNCTION IF EXISTS public.check_fanmark_availability(text)","CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid
      AND fl.status = ''active''
      AND fl.license_end > now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  is_available boolean;
  emoji_count int;
  missing_count int;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_emoji_ids'');
  END IF;

  normalized_input := regexp_replace(emoji_sequence, ''[\\x{1F3FB}-\\x{1F3FF}]'', '''', ''g'');
  emoji_count := array_length(input_emoji_ids, 1);

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level, monthly_price_usd, initial_license_days
    INTO tier_info
    FROM public.fanmark_tiers
    WHERE emoji_count_min <= emoji_count
      AND emoji_count_max >= emoji_count
      AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  END IF;

  is_available := public.check_fanmark_availability_secure(fanmark_record.id);

  RETURN json_build_object(
    ''available'', is_available,
    ''fanmark_id'', fanmark_record.id,
    ''reason'', CASE WHEN NOT is_available THEN ''taken'' ELSE null END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public"}', 'update_check_fanmark_availability_ids', NULL, NULL, NULL),
	('20251101093000', '{"-- Update fanmark availability normalization to avoid regex escape issues

CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  is_available boolean;
  emoji_count int;
  missing_count int;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_emoji_ids'');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level, monthly_price_usd, initial_license_days
    INTO tier_info
    FROM public.fanmark_tiers
    WHERE emoji_count_min <= emoji_count
      AND emoji_count_max >= emoji_count
      AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  END IF;

  is_available := public.check_fanmark_availability_secure(fanmark_record.id);

  RETURN json_build_object(
    ''available'', is_available,
    ''fanmark_id'', fanmark_record.id,
    ''reason'', CASE WHEN NOT is_available THEN ''taken'' ELSE null END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public"}', 'update_check_fanmark_availability_normalization', NULL, NULL, NULL),
	('20251102100000', '{"-- Rename fanmarks.emoji_combination to user_input_fanmark and update dependent functions

ALTER TABLE public.fanmarks
  RENAME COLUMN emoji_combination TO user_input_fanmark","ALTER TABLE public.fanmarks
  RENAME CONSTRAINT fanmarks_emoji_combination_unique TO fanmarks_user_input_fanmark_unique","DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text)","DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[])","CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL::uuid,
  emoji_ids_param uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
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
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '''' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    fl.user_id AS current_owner_id,
    fl.license_end,
    CASE
      WHEN fl.status = ''active'' AND fl.license_end > now() THEN true
      ELSE false
    END AS has_active_license,
    fl.id AS license_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = ''active''
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$","DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text)","DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(uuid[])","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(input_emoji_ids uuid[])
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
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
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN;
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''''
  );

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    f.short_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = ''active''
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.normalized_emoji = normalized_input
    AND f.status = ''active'';
END;
$function$","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO anon","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO authenticated","DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
RETURNS TABLE (
    id uuid,
    short_id text,
    user_input_fanmark text,
    emoji_ids uuid[],
    fanmark_name text,
    access_type text,
    target_url text,
    text_content text,
    status text,
    is_password_protected boolean,
    license_id uuid,
    license_status text,
    license_end timestamptz,
    grace_expires_at timestamptz,
    is_returned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.short_id,
        f.user_input_fanmark,
        f.emoji_ids,
        COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
        COALESCE(bc.access_type, ''inactive'') AS access_type,
        rc.target_url,
        mc.content AS text_content,
        f.status,
        COALESCE(pc.is_enabled, false) AS is_password_protected,
        fl.id AS license_id,
        fl.status AS license_status,
        fl.license_end,
        fl.grace_expires_at,
        fl.is_returned
    FROM fanmarks f
    LEFT JOIN LATERAL (
        SELECT fl_inner.*
        FROM fanmark_licenses fl_inner
        WHERE fl_inner.fanmark_id = f.id
          AND fl_inner.status IN (''active'', ''grace'')
        ORDER BY fl_inner.license_end DESC NULLS LAST
        LIMIT 1
    ) fl ON TRUE
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
      AND f.status = ''active'';
END;
$function$","DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text)","CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
 RETURNS TABLE(
 fanmark_id uuid,
 user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
   current_license_id uuid,
   current_owner_username text,
   current_owner_display_name text,
   current_license_start timestamp with time zone,
   current_license_end timestamp with time zone,
   current_license_status text,
   current_grace_expires_at timestamp with time zone,
   is_currently_active boolean,
   first_acquired_date timestamp with time zone,
   first_owner_username text,
   first_owner_display_name text,
   license_history jsonb,
   is_favorited boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = ''active'';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''grace_expires_at'', fl.grace_expires_at,
          ''excluded_at'', fl.excluded_at,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    CASE 
      WHEN ll.status = ''active'' AND ll.license_end > now() 
      THEN true 
      ELSE false 
    END as is_currently_active,
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, ''[]''::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE;
END;
$function$"}', 'rename_fanmark_columns', NULL, NULL, NULL),
	('20251230123000', '{"ALTER TABLE public.fanmark_licenses
ADD COLUMN IF NOT EXISTS transfer_locked_until timestamptz"}', 'add_transfer_lock_to_fanmark_licenses', NULL, NULL, NULL),
	('20251101104500', '{"-- Migrate fanmark lookup functions to use emoji IDs for lookup

DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text)","DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[])","DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text)","DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(uuid[])","CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL::uuid,
  emoji_ids_param uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  emoji_combination text,
  emoji_ids uuid[],
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
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '''' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.emoji_combination,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    fl.user_id AS current_owner_id,
    fl.license_end,
    CASE
      WHEN fl.status = ''active'' AND fl.license_end > now() THEN true
      ELSE false
    END AS has_active_license,
    fl.id AS license_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = ''active''
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(input_emoji_ids uuid[])
RETURNS TABLE(
  id uuid,
  emoji_combination text,
  emoji_ids uuid[],
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
SET search_path TO ''public''
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN;
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''''
  );

  RETURN QUERY
  SELECT
    f.id,
    f.emoji_combination,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.emoji_combination) AS fanmark_name,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    f.short_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = ''active''
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.normalized_emoji = normalized_input
    AND f.status = ''active'';
END;
$function$","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO anon","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO authenticated"}', 'update_fanmark_functions_to_ids', NULL, NULL, NULL),
	('20251102000000', '{"-- Update notification templates for license grace processing wording

-- Update Japanese template
UPDATE public.notification_templates
SET
  title = ''ライセンス失効処理中'',
  body = ''ファンマーク「{{fanmark_name}}」のライセンスが失効処理中です。{{grace_expires_at}}までに更新してください。'',
  summary = ''ライセンス更新が必要です（失効処理中）'',
  updated_at = now()
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = ''ja''
    AND channel = ''in_app''
    AND title = ''ライセンス猶予期間開始''
)","-- Update English template that shares the same template_id
UPDATE public.notification_templates
SET
  title = ''License Processing'',
  body = ''Your fanmark \"{{fanmark_name}}\" license is now processing for expiration. Renew by {{grace_expires_at}}.'',
  summary = ''License renewal required'',
  updated_at = now()
WHERE template_id IN (
  SELECT template_id
  FROM public.notification_templates
  WHERE language = ''en''
    AND channel = ''in_app''
    AND title = ''License Grace Period Started''
)"}', 'update_license_grace_notification', NULL, NULL, NULL),
	('20251102113411', '{"-- Modify handle_new_user() function to enforce invitation code for OAuth signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  invitation_mode_enabled text;
  invitation_code text;
  validation_result record;
  use_code_result record;
BEGIN
  -- Check if invitation mode is enabled
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = ''invitation_mode'';

  -- If invitation mode is enabled, validate invitation code
  IF invitation_mode_enabled = ''true'' THEN
    -- Extract invitation_code from raw_user_meta_data
    invitation_code := NEW.raw_user_meta_data ->> ''invitation_code'';

    -- Check if invitation code exists
    IF invitation_code IS NULL OR invitation_code = '''' THEN
      RAISE EXCEPTION ''Invitation code is required for sign-up'';
    END IF;

    -- Validate the invitation code
    SELECT is_valid INTO validation_result
    FROM public.validate_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR validation_result.is_valid = false THEN
      RAISE EXCEPTION ''Invalid invitation code: %'', invitation_code;
    END IF;

    -- Use (consume) the invitation code
    SELECT success INTO use_code_result
    FROM public.use_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR use_code_result.success = false THEN
      RAISE EXCEPTION ''Failed to use invitation code: %'', invitation_code;
    END IF;
  END IF;

  -- Insert user settings (with or without invitation code)
  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> ''display_name'',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    ''free'',
    COALESCE(NEW.raw_user_meta_data ->> ''preferred_language'', ''en'')::user_language,
    invitation_code
  );

  RETURN NEW;
END;
$function$"}', 'aa29aaa7-7b5a-4b20-af6c-857b1ad4dc7b', NULL, NULL, NULL),
	('20251102113723', '{"-- Update handle_new_user() to handle OAuth users differently
-- OAuth users will have invitation code validation done in the frontend
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  invitation_mode_enabled text;
  invitation_code text;
  validation_result record;
  use_code_result record;
  is_oauth_user boolean;
BEGIN
  -- Check if this is an OAuth user (has iss or provider in raw_user_meta_data)
  is_oauth_user := (
    NEW.raw_user_meta_data ? ''iss'' OR 
    NEW.raw_user_meta_data ? ''provider'' OR
    NEW.raw_user_meta_data ? ''provider_id''
  );

  -- Check if invitation mode is enabled
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = ''invitation_mode'';

  -- For email/password signups, validate invitation code if invitation mode is enabled
  IF invitation_mode_enabled = ''true'' AND NOT is_oauth_user THEN
    -- Extract invitation_code from raw_user_meta_data
    invitation_code := NEW.raw_user_meta_data ->> ''invitation_code'';

    -- Check if invitation code exists
    IF invitation_code IS NULL OR invitation_code = '''' THEN
      RAISE EXCEPTION ''Invitation code is required for sign-up'';
    END IF;

    -- Validate the invitation code
    SELECT is_valid INTO validation_result
    FROM public.validate_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR validation_result.is_valid = false THEN
      RAISE EXCEPTION ''Invalid invitation code: %'', invitation_code;
    END IF;

    -- Use (consume) the invitation code
    SELECT success INTO use_code_result
    FROM public.use_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR use_code_result.success = false THEN
      RAISE EXCEPTION ''Failed to use invitation code: %'', invitation_code;
    END IF;
  END IF;

  -- Insert user settings (with or without invitation code)
  -- OAuth users will have their invitation code updated later in the frontend
  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> ''display_name'',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    ''free'',
    COALESCE(NEW.raw_user_meta_data ->> ''preferred_language'', ''en'')::user_language,
    CASE WHEN is_oauth_user THEN NULL ELSE invitation_code END
  );

  RETURN NEW;
END;
$function$"}', 'f8af9946-005c-478e-b38d-b123418f2a3d', NULL, NULL, NULL),
	('20251102120000', '{"-- Introduce normalized_emoji_ids for ID-based normalization lookups

ALTER TABLE public.fanmarks
  ADD COLUMN IF NOT EXISTS normalized_emoji_ids uuid[] NOT NULL DEFAULT ''{}''::uuid[]","-- Seed the new column for existing rows (development environments can wipe data,
-- but this keeps forward migrations consistent).
UPDATE public.fanmarks
SET normalized_emoji_ids = COALESCE(normalized_emoji_ids, ''{}''::uuid[])
WHERE normalized_emoji_ids IS NULL","UPDATE public.fanmarks
SET normalized_emoji_ids = emoji_ids
WHERE (normalized_emoji_ids = ''{}''::uuid[] OR normalized_emoji_ids IS NULL)
  AND emoji_ids IS NOT NULL","CREATE INDEX IF NOT EXISTS idx_fanmarks_normalized_emoji_ids
  ON public.fanmarks USING gin (normalized_emoji_ids)","ALTER TABLE public.fanmarks
  DROP CONSTRAINT IF EXISTS fanmarks_emoji_combination_unique","ALTER TABLE public.fanmarks
  ADD CONSTRAINT fanmarks_normalized_emoji_ids_unique UNIQUE (normalized_emoji_ids)"}', 'add_normalized_emoji_ids', NULL, NULL, NULL),
	('20251102234052', '{"-- Allow anyone (including non-authenticated users) to view active fanmark licenses
-- This enables social proof on the homepage RecentFanmarksScroll component
-- Security: user_id is not exposed, only emoji and creation date are shown

CREATE POLICY \"Anyone can view active fanmark licenses for recent activity\"
ON public.fanmark_licenses
FOR SELECT
TO public
USING (
  status = ''active'' 
  AND license_end > now()
)"}', '000c6948-e338-4e88-a744-337aff3a23bd', NULL, NULL, NULL),
	('20251127005618', '{"-- 1. fanmark.id@gmail.com に admin ロールを追加
INSERT INTO user_roles (user_id, role)
VALUES (''962dbc8b-442b-42ff-96de-ec9b48d94610'', ''admin'')
ON CONFLICT (user_id, role) DO NOTHING","-- 2. kanouk@gmail.com の admin ロールを削除
DELETE FROM user_roles 
WHERE user_id = ''b53a2c63-fe3c-425c-94b1-dfd3438b0424'' 
  AND role = ''admin''","-- 3. kanouk@gmail.com の plan_type を creator に変更
UPDATE user_settings 
SET plan_type = ''creator'', updated_at = now()
WHERE user_id = ''b53a2c63-fe3c-425c-94b1-dfd3438b0424''"}', 'ed124346-fe70-4c69-baeb-9bde7fcf5b6d', NULL, NULL, NULL),
	('20260201090000', '{"-- Rework fanmark tier definitions and introduce tier classification helper
-- Tier mapping:
--   Tier 1 -> display \"C\" (4+ emojis, excluding consecutive sequences)
--   Tier 2 -> display \"B\" (3 emojis)
--   Tier 3 -> display \"A\" (2 emojis or any consecutive sequence 2-5)
--   Tier 4 -> display \"S\" (single emoji)

-- Allow null initial license days for perpetual tiers
ALTER TABLE public.fanmark_tiers
  ALTER COLUMN initial_license_days DROP NOT NULL","-- Add human readable display name
ALTER TABLE public.fanmark_tiers
  ADD COLUMN IF NOT EXISTS display_name text","-- Ensure license records can represent perpetual usage
ALTER TABLE public.fanmark_licenses
  ALTER COLUMN license_end DROP NOT NULL","-- Update existing tiers to new configuration
UPDATE public.fanmark_tiers
SET
  display_name = CASE tier_level
    WHEN 1 THEN ''C''
    WHEN 2 THEN ''B''
    WHEN 3 THEN ''A''
    ELSE display_name
  END,
  emoji_count_min = CASE tier_level
    WHEN 1 THEN 4
    WHEN 2 THEN 3
    WHEN 3 THEN 2
    ELSE emoji_count_min
  END,
  emoji_count_max = CASE tier_level
    WHEN 1 THEN 5
    WHEN 2 THEN 3
    WHEN 3 THEN 5
    ELSE emoji_count_max
  END,
  initial_license_days = CASE tier_level
    WHEN 1 THEN NULL
    WHEN 2 THEN 30
    WHEN 3 THEN 14
    ELSE initial_license_days
  END,
  description = CASE tier_level
    WHEN 1 THEN ''Four or more emojis (non-consecutive sequences)''
    WHEN 2 THEN ''Three emoji combinations''
    WHEN 3 THEN ''Two emojis or consecutive sequences (2-5 emojis)''
    ELSE description
  END,
  updated_at = now()
WHERE tier_level IN (1, 2, 3)","-- Insert or update Tier 4 definition (single emoji -> \"S\")
INSERT INTO public.fanmark_tiers (
  id,
  tier_level,
  display_name,
  emoji_count_min,
  emoji_count_max,
  initial_license_days,
  monthly_price_usd,
  is_active,
  description,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  4,
  ''S'',
  1,
  1,
  7,
  monthly_price_usd,
  is_active,
  ''Single emoji fanmarks'',
  now(),
  now()
FROM public.fanmark_tiers
WHERE tier_level = 3
ON CONFLICT (tier_level)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  emoji_count_min = EXCLUDED.emoji_count_min,
  emoji_count_max = EXCLUDED.emoji_count_max,
  initial_license_days = EXCLUDED.initial_license_days,
  monthly_price_usd = EXCLUDED.monthly_price_usd,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description,
  updated_at = now()","-- Make display name mandatory going forward
ALTER TABLE public.fanmark_tiers
  ALTER COLUMN display_name SET NOT NULL","-- Clone Tier 3 extension prices to Tier 4 so existing pricing continues to work
INSERT INTO public.fanmark_tier_extension_prices (
  id,
  tier_level,
  months,
  price_yen,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  4,
  months,
  price_yen,
  is_active,
  now(),
  now()
FROM public.fanmark_tier_extension_prices
WHERE tier_level = 3
ON CONFLICT (tier_level, months) DO NOTHING","-- Helper function to classify tier based on emoji id array
CREATE OR REPLACE FUNCTION public.classify_fanmark_tier(input_emoji_ids uuid[])
RETURNS TABLE(
  tier_level integer,
  display_name text,
  initial_license_days integer,
  monthly_price_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
DECLARE
  normalized_ids uuid[];
  emoji_count integer;
  unique_count integer;
  candidate_tier integer;
  tier_record RECORD;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := input_emoji_ids;
  emoji_count := array_length(normalized_ids, 1);

  -- Reject counts outside supported range (1-5)
  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT id) INTO unique_count
  FROM unnest(normalized_ids) AS t(id);

  IF emoji_count = 1 THEN
    candidate_tier := 4; -- Tier 4 (S)
  ELSIF unique_count = 1 AND emoji_count BETWEEN 2 AND 5 THEN
    candidate_tier := 3; -- Tier 3 (A) consecutive sequence overrides count rules
  ELSIF emoji_count >= 4 THEN
    candidate_tier := 1; -- Tier 1 (C)
  ELSIF emoji_count = 3 THEN
    candidate_tier := 2; -- Tier 2 (B)
  ELSIF emoji_count = 2 THEN
    candidate_tier := 3; -- Tier 3 (A)
  ELSE
    candidate_tier := 1;
  END IF;

  SELECT
    ft.tier_level,
    ft.display_name,
    ft.initial_license_days,
    ft.monthly_price_usd
  INTO tier_record
  FROM public.fanmark_tiers AS ft
  WHERE ft.tier_level = candidate_tier
    AND ft.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    tier_record.tier_level,
    tier_record.display_name,
    tier_record.initial_license_days,
    tier_record.monthly_price_usd;
END;
$function$","-- Ensure secure availability helper respects perpetual licenses
CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid
      AND (
        (fl.status = ''active'' AND (fl.license_end IS NULL OR fl.license_end > now()))
        OR (fl.status = ''grace'' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","-- Update availability function to rely on new classification helper
CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '''' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_emoji_ids'');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''tier_display_name'', tier_info.display_name,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  END IF;

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = ''grace'' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = ''active'' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = ''grace'' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = ''grace'' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = ''grace'' THEN ''grace_period''
      ELSE ''taken''
    END;
  END IF;

  RETURN json_build_object(
    ''available'', is_available,
    ''fanmark_id'', fanmark_record.id,
    ''reason'', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    ''available_at'', available_at,
    ''blocking_status'', blocking_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public","-- Keep fanmark detail helper aligned with perpetual license handling
CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL::uuid,
  emoji_ids_param uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
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
  license_id uuid,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  is_blocked_for_registration boolean,
  next_available_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '''' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '''' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    latest.user_id AS current_owner_id,
    latest.license_end,
    CASE
      WHEN latest.status = ''active'' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      ELSE false
    END AS has_active_license,
    latest.id AS license_id,
    latest.status AS current_license_status,
    latest.grace_expires_at AS current_grace_expires_at,
    CASE
      WHEN latest.status = ''active'' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      WHEN latest.status = ''grace'' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN true
      ELSE false
    END AS is_blocked_for_registration,
    CASE
      WHEN latest.status = ''grace'' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN COALESCE(latest.grace_expires_at, latest.license_end)
      WHEN latest.status = ''active'' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN latest.license_end
      ELSE NULL
    END AS next_available_at
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl.*
    FROM fanmark_licenses fl
    WHERE fl.fanmark_id = f.id
    ORDER BY (fl.license_end IS NULL) DESC, fl.license_end DESC
    LIMIT 1
  ) AS latest ON true
  LEFT JOIN fanmark_basic_configs bc ON latest.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON latest.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON latest.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON latest.id = pc.license_id
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$"}', 'rework_fanmark_tiers', NULL, NULL, NULL),
	('20251102121000', '{"-- Normalize emoji handling to rely on normalized_emoji_ids arrays

CREATE OR REPLACE FUNCTION public.normalize_emoji_ids(input_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
AS $function$
DECLARE
  normalized_ids uuid[];
  id_count int;
  missing_count int;
  unresolved_count int;
BEGIN
  IF input_ids IS NULL OR array_length(input_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  id_count := array_length(input_ids, 1);

  WITH resolved AS (
    SELECT ids.ord, em.id AS master_id, em.codepoints
    FROM unnest(input_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  ),
  normalized AS (
    SELECT
      r.ord,
      r.master_id,
      CASE
        WHEN r.codepoints IS NULL THEN NULL
        ELSE ARRAY(
          SELECT cp_value
          FROM unnest(r.codepoints) WITH ORDINALITY cp(cp_value, idx)
          WHERE cp_value NOT IN (''1F3FB'', ''1F3FC'', ''1F3FD'', ''1F3FE'', ''1F3FF'')
          ORDER BY idx
        )
      END AS normalized_codepoints
    FROM resolved r
  ),
  lookup AS (
    SELECT
      n.ord,
      n.master_id,
      n.normalized_codepoints,
      em_norm.id AS normalized_id
    FROM normalized n
    LEFT JOIN public.emoji_master em_norm
      ON em_norm.codepoints = n.normalized_codepoints
  )
  SELECT
    COUNT(*) FILTER (WHERE master_id IS NULL),
    COUNT(*) FILTER (WHERE normalized_id IS NULL),
    array_agg(normalized_id ORDER BY ord)
  INTO missing_count, unresolved_count, normalized_ids
  FROM lookup;

  IF missing_count > 0 OR unresolved_count > 0 THEN
    RETURN NULL;
  END IF;

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) <> id_count THEN
    RETURN NULL;
  END IF;

  RETURN normalized_ids;
END;
$function$","CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public
AS $function$
DECLARE
  fanmark_record RECORD;
  tier_info RECORD;
  is_available boolean;
  emoji_count int;
  normalized_ids uuid[];
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
  END IF;

  emoji_count := array_length(input_emoji_ids, 1);
  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) <> emoji_count THEN
    RETURN json_build_object(''available'', false, ''reason'', ''invalid_emoji_ids'');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji_ids = normalized_ids
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level, monthly_price_usd, initial_license_days
    INTO tier_info
    FROM public.fanmark_tiers
    WHERE emoji_count_min <= emoji_count
      AND emoji_count_max >= emoji_count
      AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        ''available'', true,
        ''tier_level'', tier_info.tier_level,
        ''price'', tier_info.monthly_price_usd,
        ''license_days'', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object(''available'', false, ''reason'', ''invalid_length'');
    END IF;
  END IF;

  is_available := public.check_fanmark_availability_secure(fanmark_record.id);

  RETURN json_build_object(
    ''available'', is_available,
    ''fanmark_id'', fanmark_record.id,
    ''reason'', CASE WHEN NOT is_available THEN ''taken'' ELSE null END
  );
END;
$function$","CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(input_emoji_ids uuid[])
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
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
SET search_path TO public
AS $function$
DECLARE
  normalized_ids uuid[];
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
    COALESCE(bc.access_type, ''inactive'') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    f.short_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = ''active''
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.normalized_emoji_ids = normalized_ids
    AND f.status = ''active'';
END;
$function$","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO anon","GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO authenticated"}', 'update_fanmark_normalized_ids', NULL, NULL, NULL),
	('20251103131358', '{"-- Drop the existing view
DROP VIEW IF EXISTS public.recent_active_fanmarks","-- Recreate the view without SECURITY DEFINER
CREATE VIEW public.recent_active_fanmarks AS
SELECT 
  fl.id AS license_id,
  fl.fanmark_id,
  f.short_id AS fanmark_short_id,
  COALESCE(f.normalized_emoji, f.user_input_fanmark) AS display_emoji,
  fl.created_at AS license_created_at
FROM fanmark_licenses fl
JOIN fanmarks f ON f.id = fl.fanmark_id
WHERE fl.status = ''active''","-- Grant SELECT permission to authenticated users
GRANT SELECT ON public.recent_active_fanmarks TO authenticated","GRANT SELECT ON public.recent_active_fanmarks TO anon"}', 'b12a02e4-afb4-4bbe-bdd4-1bacf9a2d68e', NULL, NULL, NULL),
	('20251104002400', '{"-- 既存の孤立したuser_idをNULLに設定（安全措置）
UPDATE public.fanmark_licenses
SET user_id = NULL
WHERE user_id NOT IN (SELECT id FROM auth.users)","-- 外部キー制約を追加（ユーザー削除時にuser_idをNULLに設定）
ALTER TABLE public.fanmark_licenses
ADD CONSTRAINT fanmark_licenses_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE SET NULL","-- インデックスを追加してパフォーマンス向上
CREATE INDEX IF NOT EXISTS idx_fanmark_licenses_user_id
ON public.fanmark_licenses(user_id)
WHERE user_id IS NOT NULL","-- 監査ログにコメント追加
COMMENT ON CONSTRAINT fanmark_licenses_user_id_fkey ON public.fanmark_licenses IS 
''Ensures user_id references valid auth users. Sets to NULL on user deletion to preserve license history.''"}', 'bca58fe2-60e4-4b17-b647-1a1825f5f4c4', NULL, NULL, NULL),
	('20251104035204', '{"-- Fix foreign key constraints for created_by columns to allow user deletion
-- These columns should be set to NULL when the creating user is deleted

-- Drop existing constraints
ALTER TABLE public.fanmark_availability_rules 
DROP CONSTRAINT IF EXISTS fanmark_availability_rules_created_by_fkey","ALTER TABLE public.user_roles 
DROP CONSTRAINT IF EXISTS user_roles_created_by_fkey","ALTER TABLE public.notification_rules 
DROP CONSTRAINT IF EXISTS notification_rules_created_by_fkey","-- Re-add constraints with ON DELETE SET NULL
ALTER TABLE public.fanmark_availability_rules 
ADD CONSTRAINT fanmark_availability_rules_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES auth.users(id) 
ON DELETE SET NULL","ALTER TABLE public.user_roles 
ADD CONSTRAINT user_roles_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES auth.users(id) 
ON DELETE SET NULL","ALTER TABLE public.notification_rules 
ADD CONSTRAINT notification_rules_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES auth.users(id) 
ON DELETE SET NULL","-- Add comments
COMMENT ON CONSTRAINT fanmark_availability_rules_created_by_fkey ON public.fanmark_availability_rules IS ''Set created_by to NULL when user is deleted''","COMMENT ON CONSTRAINT user_roles_created_by_fkey ON public.user_roles IS ''Set created_by to NULL when user is deleted''","COMMENT ON CONSTRAINT notification_rules_created_by_fkey ON public.notification_rules IS ''Set created_by to NULL when user is deleted''"}', 'fd03f6f2-0bcf-4b4f-aaa1-420a06650095', NULL, NULL, NULL),
	('20251105090000', '{"-- Add lottery win/lose notification templates and rules

-- Template: lottery_won (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  ''ja'',
  ''in_app'',
  ''抽選結果: 当選しました'',
  ''ファンマーク「{{fanmark_name}}」の抽選に当選しました。ライセンスは{{license_end}}まで有効です。'',
  ''抽選に当選しました'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"license_end\"]}''::jsonb,
  true
)","-- Template: lottery_won (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 当選しました'' LIMIT 1),
  1,
  ''en'',
  ''in_app'',
  ''Lottery Result: You Won'',
  ''You won the lottery for fanmark \"{{fanmark_name}}\". The license is valid until {{license_end}}.'',
  ''Lottery won'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"license_end\"]}''::jsonb,
  true
)","-- Template: lottery_won (Korean)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 当選しました'' LIMIT 1),
  1,
  ''ko'',
  ''in_app'',
  ''추첨 결과: 당첨되었습니다'',
  ''팬마크 \"{{fanmark_name}}\" 추첨에 당첨되었습니다. 라이선스는 {{license_end}}까지 유효합니다.'',
  ''추첨에 당첨되었습니다'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"license_end\"]}''::jsonb,
  true
)","-- Template: lottery_won (Indonesian)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 当選しました'' LIMIT 1),
  1,
  ''id'',
  ''in_app'',
  ''Hasil Undian: Anda Menang'',
  ''Anda memenangkan undian untuk fanmark \"{{fanmark_name}}\". Lisensi berlaku hingga {{license_end}}.'',
  ''Anda memenangkan undian'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"license_end\"]}''::jsonb,
  true
)","-- Template: lottery_lost (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  ''ja'',
  ''in_app'',
  ''抽選結果: 落選しました'',
  ''ファンマーク「{{fanmark_name}}」の抽選に落選しました（応募総数: {{total_applicants}}）。次のチャンスをお待ちください。'',
  ''抽選に落選しました'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"total_applicants\"]}''::jsonb,
  true
)","-- Template: lottery_lost (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 落選しました'' LIMIT 1),
  1,
  ''en'',
  ''in_app'',
  ''Lottery Result: Not Selected'',
  ''You were not selected in the lottery for \"{{fanmark_name}}\" (total applicants: {{total_applicants}}). Better luck next time.'',
  ''Lottery lost'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"total_applicants\"]}''::jsonb,
  true
)","-- Template: lottery_lost (Korean)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 落選しました'' LIMIT 1),
  1,
  ''ko'',
  ''in_app'',
  ''추첨 결과: 낙첨되었습니다'',
  ''팬마크 \"{{fanmark_name}}\" 추첨에 낙첨되었습니다(응모 총수: {{total_applicants}}). 다음 기회를 기다려 주세요.'',
  ''추첨에 낙첨되었습니다'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"total_applicants\"]}''::jsonb,
  true
)","-- Template: lottery_lost (Indonesian)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 落選しました'' LIMIT 1),
  1,
  ''id'',
  ''in_app'',
  ''Hasil Undian: Tidak Terpilih'',
  ''Anda tidak terpilih dalam undian \"{{fanmark_name}}\" (total peserta: {{total_applicants}}). Coba lagi di kesempatan berikutnya.'',
  ''Tidak terpilih dalam undian'',
  ''{\"required\": [\"user_id\", \"fanmark_id\", \"fanmark_name\", \"total_applicants\"]}''::jsonb,
  true
)","-- Rule: lottery_won -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  ''lottery_won'',
  ''in_app'',
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 当選しました'' LIMIT 1),
  1,
  10,
  0,
  true,
  NULL,
  NULL
)","-- Rule: lottery_lost -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  ''lottery_lost'',
  ''in_app'',
  (SELECT template_id FROM public.notification_templates WHERE language = ''ja'' AND title = ''抽選結果: 落選しました'' LIMIT 1),
  1,
  5,
  0,
  true,
  NULL,
  NULL
)"}', 'add_lottery_notifications', NULL, NULL, NULL),
	('20251109130224', '{"-- Add Stripe configuration settings to system_settings table
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES 
  (''creator_stripe_price_id'', ''price_1SRXrAJ9Sc4J9g7EG9hEt1td'', ''Creator Plan Stripe Price ID'', true),
  (''business_stripe_price_id'', ''price_1SRXrXJ9Sc4J9g7Ed64bgbBY'', ''Business Plan Stripe Price ID'', true),
  (''stripe_mode'', ''test'', ''Current Stripe mode (test or live)'', true)
ON CONFLICT (setting_key) DO UPDATE
SET 
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public"}', 'f078e5f3-0370-4b4d-8617-a3321df032e0', NULL, NULL, NULL),
	('20251201090000', '{"-- Align favorite linkage with normalized sequence keys and improve discovery syncing

CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
 RETURNS TABLE(
  fanmark_id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''public''
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  SELECT f.id,
         f.user_input_fanmark,
         f.emoji_ids,
         f.normalized_emoji,
         f.short_id,
         f.created_at,
         f.normalized_emoji_ids
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param
    AND f.status = ''active'';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          ''license_start'', fl.license_start,
          ''license_end'', fl.license_end,
          ''grace_expires_at'', fl.grace_expires_at,
          ''excluded_at'', fl.excluded_at,
          ''username'', us.username,
          ''display_name'', us.display_name,
          ''status'', fl.status,
          ''is_initial_license'', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT
      CASE
        WHEN current_user_id IS NULL THEN false
        ELSE EXISTS (
          SELECT 1
          FROM public.fanmark_favorites ff
          WHERE ff.user_id = current_user_id
            AND seq_key(ff.normalized_emoji_ids) = seq_key(fanmark_record.normalized_emoji_ids)
        )
      END AS is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    CASE 
      WHEN ll.status = ''active'' AND ll.license_end > now() 
      THEN true 
      ELSE false 
    END as is_currently_active,
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, ''[]''::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE;
END;
$function$","CREATE OR REPLACE FUNCTION public.add_fanmark_favorite(input_emoji_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION ''Authentication required'';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION ''Invalid emoji ids'';
  END IF;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  SELECT fanmark_id INTO linked_fanmark_id
  FROM public.fanmark_discoveries
  WHERE id = discovery_id;

  IF linked_fanmark_id IS NULL THEN
    SELECT f.id
    INTO linked_fanmark_id
    FROM public.fanmarks f
    WHERE seq_key(f.normalized_emoji_ids) = seq_key(normalized_ids)
    LIMIT 1;
  END IF;

  IF linked_fanmark_id IS NOT NULL THEN
    UPDATE public.fanmark_discoveries
    SET fanmark_id = linked_fanmark_id
    WHERE id = discovery_id
      AND fanmark_id IS DISTINCT FROM linked_fanmark_id;
  END IF;

  INSERT INTO public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids
  )
  VALUES (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids
  )
  ON CONFLICT (user_id, seq_key(normalized_emoji_ids))
  DO NOTHING;

  IF NOT FOUND THEN
    IF linked_fanmark_id IS NOT NULL THEN
      UPDATE public.fanmark_favorites
      SET fanmark_id = linked_fanmark_id
      WHERE user_id = auth_user_id
        AND normalized_emoji_ids = normalized_ids
        AND fanmark_id IS DISTINCT FROM linked_fanmark_id;
    END IF;
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = favorite_count + 1
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES (''favorite_add'', auth_user_id, discovery_id, normalized_ids);

  RETURN true;
END;
$function$","-- Ensure discoveries and favorites are linked to concrete fanmarks where possible
SELECT public.link_fanmark_discovery(f.id, f.normalized_emoji_ids)
FROM public.fanmarks f"}', 'update_fanmark_favorites_linkage', NULL, NULL, NULL),
	('20251109072029', '{"-- Update handle_new_user trigger function to default to Japanese
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  generated_username text;
  invitation_mode_enabled text;
  social_login_enabled text;
  invitation_code text;
  validation_result record;
  use_code_result record;
  is_oauth_user boolean;
BEGIN
  -- Determine if this signup came from an OAuth provider
  is_oauth_user := (
    NEW.raw_user_meta_data ? ''iss'' OR
    NEW.raw_user_meta_data ? ''provider'' OR
    NEW.raw_user_meta_data ? ''provider_id''
  );

  -- Fetch invitation mode flag
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = ''invitation_mode'';

  -- Fetch social login toggle (defaults to true when missing)
  SELECT setting_value INTO social_login_enabled
  FROM public.system_settings
  WHERE setting_key = ''social_login_enabled'';

  IF social_login_enabled IS NULL THEN
    social_login_enabled := ''true'';
  END IF;

  -- Block OAuth signups when invitation mode is active or social login is disabled
  IF is_oauth_user THEN
    IF invitation_mode_enabled = ''true'' THEN
      RAISE EXCEPTION ''Social login is not allowed while invitation mode is active'';
    END IF;

    IF social_login_enabled = ''false'' THEN
      RAISE EXCEPTION ''Social login is currently disabled'';
    END IF;
  END IF;

  -- For email/password signups, enforce invitation code when required
  IF invitation_mode_enabled = ''true'' AND NOT is_oauth_user THEN
    invitation_code := NEW.raw_user_meta_data ->> ''invitation_code'';

    IF invitation_code IS NULL OR invitation_code = '''' THEN
      RAISE EXCEPTION ''Invitation code is required for sign-up'';
    END IF;

    SELECT is_valid INTO validation_result
    FROM public.validate_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR validation_result.is_valid = false THEN
      RAISE EXCEPTION ''Invalid invitation code: %'', invitation_code;
    END IF;

    SELECT success INTO use_code_result
    FROM public.use_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR use_code_result.success = false THEN
      RAISE EXCEPTION ''Failed to use invitation code: %'', invitation_code;
    END IF;
  END IF;

  -- Generate a username once so we can reuse it as the safe default display name
  generated_username := COALESCE(NEW.raw_user_meta_data ->> ''username'', ''user_'' || substring(NEW.id::text, 1, 8));

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  ) VALUES (
    NEW.id,
    generated_username,
    COALESCE(NEW.raw_user_meta_data ->> ''display_name'', generated_username),
    ''free'',
    COALESCE(NEW.raw_user_meta_data ->> ''preferred_language'', ''ja'')::user_language,
    CASE WHEN NOT is_oauth_user THEN NEW.raw_user_meta_data ->> ''invitation_code'' ELSE NULL END,
    CASE WHEN is_oauth_user THEN true ELSE false END
  );

  RETURN NEW;
END;
$function$","-- Update default value for preferred_language column to Japanese
ALTER TABLE public.user_settings 
ALTER COLUMN preferred_language SET DEFAULT ''ja''","COMMENT ON COLUMN public.user_settings.preferred_language IS 
''User preferred language. Defaults to Japanese (ja) for new users.''"}', '3b6d99c6-177f-4bb2-bbad-a777a2276507', NULL, NULL, NULL),
	('20251109131414', '{"-- Create user_subscriptions table for caching Stripe subscription data
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL, -- active, canceled, past_due, etc.
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, stripe_subscription_id)
)","-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON public.user_subscriptions(user_id)","CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer_id ON public.user_subscriptions(stripe_customer_id)","CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions(status)","-- Enable RLS
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY","-- Users can view their own subscriptions
CREATE POLICY \"Users can view their own subscriptions\"
  ON public.user_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id)","-- Service role can manage all subscriptions (for webhooks)
CREATE POLICY \"Service role can manage all subscriptions\"
  ON public.user_subscriptions
  FOR ALL
  USING (auth.role() = ''service_role'')","-- Admins can view all subscriptions
CREATE POLICY \"Admins can view all subscriptions\"
  ON public.user_subscriptions
  FOR SELECT
  USING (is_admin())","-- Trigger to update updated_at
CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column()"}', '91064326-cd41-42c7-8b51-ccc028005fea', NULL, NULL, NULL),
	('20251113204508', '{"-- Function to mark all notifications as read for a user

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  user_id_param uuid,
  read_via_param text DEFAULT ''app''
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  updated_count integer;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION ''Authentication required'';
  END IF;

  -- Only allow users to mark their own notifications as read
  IF current_user_id != user_id_param THEN
    RAISE EXCEPTION ''Unauthorized: can only mark own notifications as read'';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE user_id = user_id_param
    AND read_at IS NULL
    AND status = ''delivered''
    AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN updated_count;
END;
$$"}', 'add_mark_all_notifications_read', NULL, NULL, NULL),
	('20251125040519', '{"-- Phase 2: Add Stripe Price ID columns to fanmark_tier_extension_prices
ALTER TABLE fanmark_tier_extension_prices
ADD COLUMN IF NOT EXISTS stripe_price_id_test TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_id_live TEXT","COMMENT ON COLUMN fanmark_tier_extension_prices.stripe_price_id_test IS ''Stripe Price ID for test mode (e.g., price_xxxxx)''","COMMENT ON COLUMN fanmark_tier_extension_prices.stripe_price_id_live IS ''Stripe Price ID for live/production mode (e.g., price_yyyyy)''","-- Add stripe_mode to system_settings if not exists
INSERT INTO system_settings (setting_key, setting_value, is_public, description)
VALUES (
  ''stripe_mode'',
  ''test'',
  true,
  ''Current Stripe environment mode: test or live''
)
ON CONFLICT (setting_key) DO NOTHING"}', '7ac891b9-b667-4dd7-bd07-a6db37fb6dc4', NULL, NULL, NULL),
	('20251128010000', '{"-- Link fanmark discoveries/favorites to newly created fanmarks

CREATE OR REPLACE FUNCTION public.link_fanmark_discovery(new_fanmark_id uuid, normalized_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  linked_discovery_id uuid;
BEGIN
  IF new_fanmark_id IS NULL OR normalized_ids IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_discoveries
  SET fanmark_id = new_fanmark_id,
      availability_status = ''owned_by_user''
  WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
  RETURNING id INTO linked_discovery_id;

  IF linked_discovery_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_favorites
  SET fanmark_id = new_fanmark_id
  WHERE discovery_id = linked_discovery_id;
END;
$function$","CREATE OR REPLACE FUNCTION public.link_fanmark_discovery_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  PERFORM public.link_fanmark_discovery(NEW.id, NEW.normalized_emoji_ids);
  RETURN NEW;
END;
$function$","DROP TRIGGER IF EXISTS trg_link_fanmark_discovery ON public.fanmarks","CREATE TRIGGER trg_link_fanmark_discovery
AFTER INSERT ON public.fanmarks
FOR EACH ROW
EXECUTE FUNCTION public.link_fanmark_discovery_trigger()","-- Backfill existing fanmarks
SELECT public.link_fanmark_discovery(f.id, f.normalized_emoji_ids)
FROM public.fanmarks f"}', 'link_discoveries_to_fanmarks', NULL, NULL, NULL),
	('20251206070851', '{"-- 1. Update license_grace_started templates to mention settings won''t be carried over
UPDATE notification_templates
SET body = ''Your fanmark \"{{fanmark_name}}\" license has entered the grace period. Please renew by {{grace_expires_at}} to keep your fanmark. After the deadline, even if you win it back through lottery, your access settings will not be carried over.'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''en''","UPDATE notification_templates
SET body = ''ファンマーク「{{fanmark_name}}」のライセンスが失効処理中です。{{grace_expires_at}}までに更新してください。期限を過ぎると、抽選で再当選してもファンマアクセスの設定は引き継がれません。'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''ja''","UPDATE notification_templates
SET body = ''팬마크 \"{{fanmark_name}}\" 라이선스가 유예 기간에 들어갔습니다. {{grace_expires_at}}까지 갱신하세요. 기한이 지나면 추첨에서 다시 당첨되더라도 액세스 설정이 이전되지 않습니다.'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''ko''","UPDATE notification_templates
SET body = ''Lisensi fanmark \"{{fanmark_name}}\" sedang dalam masa tenggang. Perbarui sebelum {{grace_expires_at}}. Setelah batas waktu, meskipun Anda memenangkannya kembali melalui lotre, pengaturan akses tidak akan dipertahankan.'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''id''","-- 2. Update license_expired templates to mention settings have been deleted
UPDATE notification_templates
SET body = ''Your fanmark \"{{fanmark_name}}\" license has expired. Your access settings have been deleted.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''en''","UPDATE notification_templates
SET body = ''ファンマーク「{{fanmark_name}}」のライセンスが失効しました。ファンマアクセスの設定データは削除されました。'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ja''","UPDATE notification_templates
SET body = ''팬마크 \"{{fanmark_name}}\"의 라이선스가 만료되었습니다. 액세스 설정 데이터가 삭제되었습니다.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ko''","UPDATE notification_templates
SET body = ''Lisensi fanmark \"{{fanmark_name}}\" Anda telah kedaluwarsa. Data pengaturan akses telah dihapus.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''id''","-- 3. Create notification templates for fanmark_returned_owner (4 languages)
INSERT INTO notification_templates (template_id, version, language, channel, title, body, summary, is_active)
VALUES 
  (''a1b2c3d4-e5f6-7890-abcd-ef1234567890'', 1, ''en'', ''in_app'', ''Fanmark Returned'', ''You have returned fanmark \"{{fanmark_name}}\". It will be available for lottery until {{grace_expires_at}}. Please note that even if you win it back through lottery, your access settings will not be carried over.'', ''Fanmark has been returned'', true),
  (''a1b2c3d4-e5f6-7890-abcd-ef1234567890'', 1, ''ja'', ''in_app'', ''ファンマーク返却完了'', ''ファンマーク「{{fanmark_name}}」を返却しました。{{grace_expires_at}}まで抽選の対象となります。抽選で再当選した場合でも、ファンマアクセスの設定は引き継がれませんのでご注意ください。'', ''ファンマークを返却しました'', true),
  (''a1b2c3d4-e5f6-7890-abcd-ef1234567890'', 1, ''ko'', ''in_app'', ''팬마크 반환 완료'', ''팬마크 \"{{fanmark_name}}\"를 반환했습니다. {{grace_expires_at}}까지 추첨 대상이 됩니다. 추첨에서 다시 당첨되더라도 액세스 설정이 이전되지 않으니 주의해 주세요.'', ''팬마크가 반환되었습니다'', true),
  (''a1b2c3d4-e5f6-7890-abcd-ef1234567890'', 1, ''id'', ''in_app'', ''Fanmark Dikembalikan'', ''Anda telah mengembalikan fanmark \"{{fanmark_name}}\". Fanmark akan tersedia untuk lotre hingga {{grace_expires_at}}. Perhatikan bahwa meskipun Anda memenangkannya kembali melalui lotre, pengaturan akses tidak akan dipertahankan.'', ''Fanmark telah dikembalikan'', true)","-- 4. Create new notification rule for fanmark_returned_owner (priority 1-10)
INSERT INTO notification_rules (
  event_type, channel, template_id, template_version, delay_seconds, priority, enabled
) VALUES (
  ''fanmark_returned_owner'', ''in_app'', ''a1b2c3d4-e5f6-7890-abcd-ef1234567890'', 1, 0, 5, true
)"}', '56d591a4-af67-49ae-9954-be648c6ce6b8', NULL, NULL, NULL),
	('20251208151219', '{"-- Update lottery_won notification templates to use formatted date
UPDATE public.notification_templates
SET body = REPLACE(body, ''{{license_end}}'', ''{{license_end_formatted}}''),
    updated_at = now()
WHERE template_id IN (
  SELECT DISTINCT template_id 
  FROM public.notification_templates 
  WHERE template_id::text LIKE ''%lottery_won%''
    OR template_id IN (
      SELECT id FROM public.notification_rules WHERE event_type = ''lottery_won''
    )
)
AND body LIKE ''%{{license_end}}%''"}', 'a59c2953-db2b-4b72-89db-d9392c9d019f', NULL, NULL, NULL),
	('20251205130317', '{"-- Fix English version of license_grace_started (was incorrectly in Japanese)
UPDATE public.notification_templates
SET 
  title = ''License Grace Period Started'',
  body = ''Your fanmark \"{{fanmark_name}}\" license has entered the grace period. Please renew by {{grace_expires_at}} to keep your fanmark.'',
  summary = ''License renewal required'',
  updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' 
  AND language = ''en''","-- Add Korean (ko) translations
INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  ''47406236-126d-40ef-bc0c-da2d14cc1df9''::uuid, ''in_app'', ''ko'', ''라이선스 만료'', 
  ''팬마크 \"{{fanmark_name}}\"의 라이선스가 만료되었습니다. 다시 취득할 수 있습니다.'', 
  ''라이선스가 만료되었습니다'', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ko''
)","INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  ''4ba5ee3e-4222-4001-9a9f-8e968b36e920''::uuid, ''in_app'', ''ko'', ''즐겨찾기 팬마크 이용 가능'', 
  ''즐겨찾기한 팬마크 \"{{fanmark_name}}\"가 반환되어 곧 재취득 기회가 옵니다!'', 
  ''즐겨찾기 팬마크를 취득할 수 있습니다'', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = ''4ba5ee3e-4222-4001-9a9f-8e968b36e920'' AND language = ''ko''
)","INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  ''efa32487-428f-4bb8-b4b3-90b5544e001a''::uuid, ''in_app'', ''ko'', ''라이선스 유예 기간 시작'', 
  ''팬마크 \"{{fanmark_name}}\" 라이선스가 유예 기간에 들어갔습니다. {{grace_expires_at}}까지 갱신하세요.'', 
  ''라이선스 갱신이 필요합니다'', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''ko''
)","-- Add Indonesian (id) translations
INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  ''47406236-126d-40ef-bc0c-da2d14cc1df9''::uuid, ''in_app'', ''id'', ''Lisensi Kedaluwarsa'', 
  ''Lisensi fanmark \"{{fanmark_name}}\" Anda telah kedaluwarsa. Anda dapat memperolehnya kembali.'', 
  ''Lisensi telah kedaluwarsa'', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''id''
)","INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  ''4ba5ee3e-4222-4001-9a9f-8e968b36e920''::uuid, ''in_app'', ''id'', ''Fanmark Favorit Tersedia'', 
  ''Fanmark favorit Anda \"{{fanmark_name}}\" telah dikembalikan. Kesempatan untuk mendapatkannya kembali akan segera tiba!'', 
  ''Fanmark favorit dapat diperoleh'', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = ''4ba5ee3e-4222-4001-9a9f-8e968b36e920'' AND language = ''id''
)","INSERT INTO public.notification_templates (template_id, channel, language, title, body, summary, version, is_active)
SELECT 
  ''efa32487-428f-4bb8-b4b3-90b5544e001a''::uuid, ''in_app'', ''id'', ''Masa Tenggang Lisensi Dimulai'', 
  ''Lisensi fanmark \"{{fanmark_name}}\" sedang dalam masa tenggang. Perbarui sebelum {{grace_expires_at}}.'', 
  ''Perpanjangan lisensi diperlukan'', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates 
  WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''id''
)"}', '0dacd4a8-834f-429b-8432-6492fc43ba3d', NULL, NULL, NULL),
	('20251205131726', '{"-- Update license_expired template to remove misleading \"can reacquire\" phrase
-- Template ID: 47406236-126d-40ef-bc0c-da2d14cc1df9

UPDATE public.notification_templates
SET body = ''ファンマーク「{{fanmark_name}}」のライセンスが失効しました。'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ja''","UPDATE public.notification_templates
SET body = ''Your fanmark \"{{fanmark_name}}\" license has expired.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''en''","UPDATE public.notification_templates
SET body = ''팬마크 \"{{fanmark_name}}\"의 라이선스가 만료되었습니다.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ko''","UPDATE public.notification_templates
SET body = ''Lisensi fanmark \"{{fanmark_name}}\" Anda telah kedaluwarsa.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''id''"}', '172f8809-af13-4e14-8b77-0529a0288ea7', NULL, NULL, NULL),
	('20251206024020', '{"-- =====================================================
-- Phase 1: Analytics Tables Migration
-- =====================================================

-- 1. fanmark_access_logs テーブル（生ログ）
CREATE TABLE public.fanmark_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE CASCADE NOT NULL,
  license_id uuid REFERENCES public.fanmark_licenses(id) ON DELETE SET NULL,
  accessed_at timestamptz DEFAULT now() NOT NULL,
  referrer text,
  referrer_domain text,
  referrer_category text, -- ''direct'', ''search'', ''social'', ''other''
  user_agent text,
  device_type text, -- ''mobile'', ''tablet'', ''desktop''
  browser text,
  os text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  visitor_hash text -- プライバシー考慮のハッシュ化された訪問者ID
)","-- インデックス
CREATE INDEX idx_access_logs_fanmark_id ON public.fanmark_access_logs(fanmark_id)","CREATE INDEX idx_access_logs_accessed_at ON public.fanmark_access_logs(accessed_at)","CREATE INDEX idx_access_logs_fanmark_date ON public.fanmark_access_logs(fanmark_id, accessed_at)","CREATE INDEX idx_access_logs_visitor_hash ON public.fanmark_access_logs(visitor_hash, accessed_at)","-- 2. fanmark_access_daily_stats テーブル（日次集計）
CREATE TABLE public.fanmark_access_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE CASCADE NOT NULL,
  license_id uuid REFERENCES public.fanmark_licenses(id) ON DELETE SET NULL,
  stat_date date NOT NULL,
  access_count integer DEFAULT 0,
  unique_visitors integer DEFAULT 0,
  -- リファラー別
  referrer_direct integer DEFAULT 0,
  referrer_search integer DEFAULT 0,
  referrer_social integer DEFAULT 0,
  referrer_other integer DEFAULT 0,
  -- デバイス別
  device_mobile integer DEFAULT 0,
  device_tablet integer DEFAULT 0,
  device_desktop integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(fanmark_id, stat_date)
)","-- インデックス
CREATE INDEX idx_daily_stats_fanmark_date ON public.fanmark_access_daily_stats(fanmark_id, stat_date)","-- =====================================================
-- RLS Policies
-- =====================================================

-- fanmark_access_logs RLS
ALTER TABLE public.fanmark_access_logs ENABLE ROW LEVEL SECURITY","-- 所有者のみ閲覧可能
CREATE POLICY \"Owners can view their fanmark access logs\"
  ON public.fanmark_access_logs FOR SELECT
  USING (
    fanmark_id IN (
      SELECT fl.fanmark_id FROM public.fanmark_licenses fl
      WHERE fl.user_id = auth.uid()
    )
  )","-- fanmark_access_daily_stats RLS
ALTER TABLE public.fanmark_access_daily_stats ENABLE ROW LEVEL SECURITY","-- 所有者のみ閲覧可能
CREATE POLICY \"Owners can view their fanmark daily stats\"
  ON public.fanmark_access_daily_stats FOR SELECT
  USING (
    fanmark_id IN (
      SELECT fl.fanmark_id FROM public.fanmark_licenses fl
      WHERE fl.user_id = auth.uid()
    )
  )"}', '5cdb323d-d213-4cae-92ac-038f4e0f423a', NULL, NULL, NULL),
	('20251206122925', '{"-- Update max_fanmarks_limit to 500 for the max plan
UPDATE public.system_settings 
SET setting_value = ''500'', updated_at = now()
WHERE setting_key = ''max_fanmarks_limit''","-- Add max_pricing setting (10000 yen)
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES (''max_pricing'', ''10000'', ''Monthly price for Max plan in JPY'', true)
ON CONFLICT (setting_key) DO UPDATE SET setting_value = ''10000'', updated_at = now()","-- Add max_stripe_price_id setting
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES (''max_stripe_price_id'', ''price_1SbKbmJ9Sc4J9g7E2SYcL67D'', ''Stripe Price ID for Max plan'', true)
ON CONFLICT (setting_key) DO UPDATE SET setting_value = ''price_1SbKbmJ9Sc4J9g7E2SYcL67D'', updated_at = now()"}', 'cf578873-93db-40f6-8cc8-4b0a0220aa39', NULL, NULL, NULL),
	('20251207', '{"-- =====================================================
-- Add access_type to analytics tables for access type breakdown
-- =====================================================

-- 1. Add access_type column to fanmark_access_logs
ALTER TABLE public.fanmark_access_logs
ADD COLUMN IF NOT EXISTS access_type text","-- 2. Add access_type columns to fanmark_access_daily_stats for breakdown
ALTER TABLE public.fanmark_access_daily_stats
ADD COLUMN IF NOT EXISTS access_type_profile integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS access_type_redirect integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS access_type_text integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS access_type_inactive integer DEFAULT 0","-- 3. Add index for access_type queries
CREATE INDEX IF NOT EXISTS idx_access_logs_access_type ON public.fanmark_access_logs(access_type)","CREATE INDEX IF NOT EXISTS idx_daily_stats_fanmark_date_type ON public.fanmark_access_daily_stats(fanmark_id, stat_date, access_type_profile, access_type_redirect, access_type_text, access_type_inactive)","-- 4. Add comment for documentation
COMMENT ON COLUMN public.fanmark_access_logs.access_type IS ''Access type at the time of access: profile, redirect, text, inactive''","COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_profile IS ''Daily count of profile access type''","COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_redirect IS ''Daily count of redirect access type''","COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_text IS ''Daily count of text (messageboard) access type''","COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_inactive IS ''Daily count of inactive access type''"}', 'add_access_type_to_analytics', NULL, NULL, NULL),
	('20251209000712', '{"-- Fix function search_path for generate_transfer_code_string
CREATE OR REPLACE FUNCTION public.generate_transfer_code_string()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  chars text := ''ABCDEFGHJKLMNPQRSTUVWXYZ23456789'';
  result text := '''';
  i integer;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || ''-'';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || ''-'';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$"}', '3d139902-63a7-478a-85a6-afb0939acd48', NULL, NULL, NULL),
	('20251211130034', '{"-- Update Tier B (tier_level=2) prices
UPDATE fanmark_tier_extension_prices 
SET price_yen = 500, stripe_price_id = ''price_1Sd9RdJ9Sc4J9g7E7wHRfLb7'', updated_at = now()
WHERE tier_level = 2 AND months = 1","UPDATE fanmark_tier_extension_prices 
SET price_yen = 1000, stripe_price_id = ''price_1Sd9ReJ9Sc4J9g7EYHWy2FQ3'', updated_at = now()
WHERE tier_level = 2 AND months = 2","UPDATE fanmark_tier_extension_prices 
SET price_yen = 1500, stripe_price_id = ''price_1Sd9RfJ9Sc4J9g7ED7Wu1mGr'', updated_at = now()
WHERE tier_level = 2 AND months = 3","UPDATE fanmark_tier_extension_prices 
SET price_yen = 3000, stripe_price_id = ''price_1Sd9RgJ9Sc4J9g7EUJL9wAQK'', updated_at = now()
WHERE tier_level = 2 AND months = 6","-- Update Tier A (tier_level=3) prices
UPDATE fanmark_tier_extension_prices 
SET price_yen = 1000, stripe_price_id = ''price_1Sd9RhJ9Sc4J9g7EkHq1oQ6k'', updated_at = now()
WHERE tier_level = 3 AND months = 1","UPDATE fanmark_tier_extension_prices 
SET price_yen = 2000, stripe_price_id = ''price_1Sd9RiJ9Sc4J9g7EiWsx6lyT'', updated_at = now()
WHERE tier_level = 3 AND months = 2","UPDATE fanmark_tier_extension_prices 
SET price_yen = 3000, stripe_price_id = ''price_1Sd9RjJ9Sc4J9g7Eb77lK5Np'', updated_at = now()
WHERE tier_level = 3 AND months = 3","UPDATE fanmark_tier_extension_prices 
SET price_yen = 5000, stripe_price_id = ''price_1Sd9RkJ9Sc4J9g7EQYqNey7N'', updated_at = now()
WHERE tier_level = 3 AND months = 6","-- Update Tier S (tier_level=4) prices
UPDATE fanmark_tier_extension_prices 
SET price_yen = 2000, stripe_price_id = ''price_1Sd9RlJ9Sc4J9g7EKKoq1SsU'', updated_at = now()
WHERE tier_level = 4 AND months = 1","UPDATE fanmark_tier_extension_prices 
SET price_yen = 4000, stripe_price_id = ''price_1Sd9RmJ9Sc4J9g7Et5Tzlng0'', updated_at = now()
WHERE tier_level = 4 AND months = 2","UPDATE fanmark_tier_extension_prices 
SET price_yen = 6000, stripe_price_id = ''price_1Sd9RnJ9Sc4J9g7EdrwkytqE'', updated_at = now()
WHERE tier_level = 4 AND months = 3","UPDATE fanmark_tier_extension_prices 
SET price_yen = 10000, stripe_price_id = ''price_1Sd9RnJ9Sc4J9g7E56MpeeXI'', updated_at = now()
WHERE tier_level = 4 AND months = 6"}', '60122182-ce85-47a9-a585-b1308908a5e6', NULL, NULL, NULL),
	('20251212001130', '{"-- Update handle_new_user function to set display_name same as username
-- This prevents unintentionally exposing email addresses as display names

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  generated_username TEXT;
BEGIN
  -- Generate username: user_ + first 8 chars of UUID
  generated_username := COALESCE(
    NEW.raw_user_meta_data ->> ''username'',
    ''user_'' || substring(NEW.id::text, 1, 8)
  );

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  )
  VALUES (
    NEW.id,
    generated_username,
    -- Use the same value as username for display_name (privacy protection)
    COALESCE(NEW.raw_user_meta_data ->> ''display_name'', generated_username),
    COALESCE((NEW.raw_user_meta_data ->> ''plan_type'')::user_plan, ''free''),
    COALESCE((NEW.raw_user_meta_data ->> ''preferred_language'')::user_language, ''ja''),
    NEW.raw_user_meta_data ->> ''invited_by_code'',
    COALESCE((NEW.raw_user_meta_data ->> ''requires_password_setup'')::boolean, false)
  );
  RETURN NEW;
END;
$$"}', '26df01c5-eabf-4908-bae4-cf1cb8fab89f', NULL, NULL, NULL),
	('20251212015214', '{"-- Restore the public access policy for fanmark_licenses
-- This is intentional design: fanmark ownership is public information (like domain WHOIS)
-- user_id is a UUID that cannot be linked to PII without access to user_settings (which is protected)

CREATE POLICY \"Anyone can view active fanmark licenses for recent activity\" 
ON public.fanmark_licenses
FOR SELECT
USING (status = ''active'')"}', '5e0a2ba5-a70f-4071-bff5-ff7244bf2057', NULL, NULL, NULL),
	('20251222090000', '{"-- Allow admins to manage fanmark tiers from the dashboard

ALTER TABLE public.fanmark_tiers ENABLE ROW LEVEL SECURITY","DROP POLICY IF EXISTS \"Allow admin read fanmark tiers\" ON public.fanmark_tiers","CREATE POLICY \"Allow admin read fanmark tiers\"
ON public.fanmark_tiers
FOR SELECT
USING (public.is_admin())","DROP POLICY IF EXISTS \"Allow admin update fanmark tiers\" ON public.fanmark_tiers","CREATE POLICY \"Allow admin update fanmark tiers\"
ON public.fanmark_tiers
FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin())"}', 'add_admin_policies_for_fanmark_tiers', NULL, NULL, NULL),
	('20251229065804', '{"-- Create notification templates for lottery_cancelled_by_extension event
-- First, create a template_id that will be shared across languages
DO $$
DECLARE
  v_template_id uuid := gen_random_uuid();
BEGIN
  -- Japanese template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    ''in_app'',
    ''ja'',
    1,
    ''抽選キャンセル'',
    ''ファンマーク「{{fanmark_emoji}}」の抽選は、所有者がライセンスを延長したためキャンセルされました。'',
    ''抽選がキャンセルされました'',
    true
  );

  -- English template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    ''in_app'',
    ''en'',
    1,
    ''Lottery Cancelled'',
    ''The lottery for \"{{fanmark_emoji}}\" has been cancelled because the owner extended their license.'',
    ''Lottery has been cancelled'',
    true
  );

  -- Korean template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    ''in_app'',
    ''ko'',
    1,
    ''추첨 취소'',
    ''팬마크 \"{{fanmark_emoji}}\" 추첨이 소유자의 라이선스 연장으로 취소되었습니다.'',
    ''추첨이 취소되었습니다'',
    true
  );

  -- Indonesian template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    ''in_app'',
    ''id'',
    1,
    ''Undian Dibatalkan'',
    ''Undian untuk \"{{fanmark_emoji}}\" dibatalkan karena pemilik memperpanjang lisensi.'',
    ''Undian telah dibatalkan'',
    true
  );

  -- Create notification rule for this event type
  INSERT INTO notification_rules (
    event_type,
    channel,
    template_id,
    template_version,
    enabled,
    priority,
    delay_seconds
  ) VALUES (
    ''lottery_cancelled_by_extension'',
    ''in_app'',
    v_template_id,
    1,
    true,
    5,
    0
  );
END $$"}', 'f6cce642-6bb0-4578-a8b6-2e08f7c14311', NULL, NULL, NULL),
	('20251229075056', '{"-- Create extension_coupons table (coupon master)
CREATE TABLE public.extension_coupons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  months smallint NOT NULL CHECK (months IN (1, 2, 3, 6)),
  allowed_tier_levels smallint[] DEFAULT NULL,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamp with time zone DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
)","-- Create extension_coupon_usages table (usage history)
CREATE TABLE public.extension_coupon_usages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id uuid NOT NULL REFERENCES extension_coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  fanmark_id uuid NOT NULL REFERENCES fanmarks(id),
  license_id uuid NOT NULL REFERENCES fanmark_licenses(id),
  used_at timestamp with time zone NOT NULL DEFAULT now()
)","-- Create indexes for performance
CREATE INDEX idx_extension_coupons_code ON extension_coupons(code)","CREATE INDEX idx_extension_coupons_active ON extension_coupons(is_active) WHERE is_active = true","CREATE INDEX idx_extension_coupon_usages_coupon_id ON extension_coupon_usages(coupon_id)","CREATE INDEX idx_extension_coupon_usages_user_id ON extension_coupon_usages(user_id)","-- Enable RLS
ALTER TABLE public.extension_coupons ENABLE ROW LEVEL SECURITY","ALTER TABLE public.extension_coupon_usages ENABLE ROW LEVEL SECURITY","-- RLS policies for extension_coupons
CREATE POLICY \"Admins can manage all coupons\"
ON public.extension_coupons
FOR ALL
USING (is_admin())
WITH CHECK (is_admin())","CREATE POLICY \"Authenticated users can validate active coupons\"
ON public.extension_coupons
FOR SELECT
USING (
  auth.uid() IS NOT NULL 
  AND is_active = true 
  AND (expires_at IS NULL OR expires_at > now())
  AND used_count < max_uses
)","-- RLS policies for extension_coupon_usages
CREATE POLICY \"Admins can manage all usages\"
ON public.extension_coupon_usages
FOR ALL
USING (is_admin())
WITH CHECK (is_admin())","CREATE POLICY \"System can insert usages\"
ON public.extension_coupon_usages
FOR INSERT
WITH CHECK (auth.role() = ''service_role'')","CREATE POLICY \"Users can view their own usages\"
ON public.extension_coupon_usages
FOR SELECT
USING (auth.uid() = user_id)","-- Create trigger for updated_at on extension_coupons
CREATE TRIGGER update_extension_coupons_updated_at
BEFORE UPDATE ON public.extension_coupons
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column()"}', 'c384c85f-8dfd-4c13-aa60-c6137bd21bea', NULL, NULL, NULL),
	('20251230070427', '{"-- Update license_grace_started template (efa32487-428f-4bb8-b4b3-90b5544e001a)
-- Add explicit \"will be deleted\" message

UPDATE public.notification_templates
SET body = ''ファンマーク「{{fanmark_name}}」のライセンスが失効処理中です。{{grace_expires_at}}までに更新してください。期限を過ぎるとファンマアクセスの設定データは削除され、復元できません。'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''ja''","UPDATE public.notification_templates
SET body = ''Your fanmark \"{{fanmark_name}}\" license has entered the grace period. Please renew by {{grace_expires_at}}. After the deadline, your access settings will be deleted and cannot be restored.'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''en''","UPDATE public.notification_templates
SET body = ''팬마크 \"{{fanmark_name}}\" 라이선스가 유예 기간에 들어갔습니다. {{grace_expires_at}}까지 갱신하세요. 기한이 지나면 액세스 설정 데이터가 삭제되며 복원할 수 없습니다.'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''ko''","UPDATE public.notification_templates
SET body = ''Lisensi fanmark \"{{fanmark_name}}\" sedang dalam masa tenggang. Perbarui sebelum {{grace_expires_at}}. Setelah batas waktu, pengaturan akses Anda akan dihapus dan tidak dapat dipulihkan.'',
    updated_at = now()
WHERE template_id = ''efa32487-428f-4bb8-b4b3-90b5544e001a'' AND language = ''id''","-- Update license_expired template (47406236-126d-40ef-bc0c-da2d14cc1df9)
-- Change from \"deleted\" to \"participate in lottery\"

UPDATE public.notification_templates
SET body = ''ファンマーク「{{fanmark_name}}」のライセンスが失効しました。再取得するには抽選に参加してください。'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ja''","UPDATE public.notification_templates
SET body = ''Your fanmark \"{{fanmark_name}}\" license has expired. To reacquire it, please participate in the lottery.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''en''","UPDATE public.notification_templates
SET body = ''팬마크 \"{{fanmark_name}}\"의 라이선스가 만료되었습니다. 재취득하려면 추첨에 참여하세요.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''ko''","UPDATE public.notification_templates
SET body = ''Lisensi fanmark \"{{fanmark_name}}\" Anda telah kedaluwarsa. Untuk mendapatkannya kembali, silakan ikuti lotre.'',
    updated_at = now()
WHERE template_id = ''47406236-126d-40ef-bc0c-da2d14cc1df9'' AND language = ''id''"}', '0ea26a89-1e3c-49fc-a12e-d65bf96446c0', NULL, NULL, NULL),
	('20251230073642', '{"-- Update render_notification_template to skip datetime placeholders
-- These will be formatted by the frontend using useNotificationFormatter

CREATE OR REPLACE FUNCTION public.render_notification_template(
  template_id_param uuid,
  template_version_param integer,
  payload_param jsonb,
  language_param text DEFAULT ''ja''::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
  -- Datetime placeholders should NOT be replaced here (frontend will format them)
  datetime_keys text[] := ARRAY[''grace_expires_at'', ''license_end'', ''expires_at'', ''created_at'', ''updated_at''];
BEGIN
  -- Fetch template
  SELECT title, body, summary
  INTO template_record
  FROM public.notification_templates
  WHERE template_id = template_id_param
    AND version = template_version_param
    AND language = language_param
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Template not found: % version % language %'', 
      template_id_param, template_version_param, language_param;
  END IF;

  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  -- Replace placeholders with payload values (except datetime keys)
  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    IF NOT (key_name = ANY(datetime_keys)) THEN
      rendered_title := REPLACE(rendered_title, ''{{'' || key_name || ''}}'', payload_param->>key_name);
      rendered_body := REPLACE(rendered_body, ''{{'' || key_name || ''}}'', payload_param->>key_name);
      IF rendered_summary IS NOT NULL THEN
        rendered_summary := REPLACE(rendered_summary, ''{{'' || key_name || ''}}'', payload_param->>key_name);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    ''title'', rendered_title,
    ''body'', rendered_body,
    ''summary'', rendered_summary,
    ''metadata'', payload_param
  );
END;
$function$"}', 'ade45bc1-ede7-47a8-bb4b-9de561483121', NULL, NULL, NULL),
	('20251230074501', '{"-- Update favorite fanmark returned notification template to include grace_expires_at
UPDATE notification_templates
SET 
  body = ''お気に入り登録していたファンマ「{{fanmark_name}}」が返却中です。{{grace_expires_at}}までに抽選に参加しましょう！'',
  summary = ''抽選に参加して再取得のチャンスをつかもう'',
  updated_at = now()
WHERE template_id = ''4ba5ee3e-4222-4001-9a9f-8e968b36e920''
  AND language = ''ja''"}', 'b16e6f60-98e1-417d-be2b-02c51693e886', NULL, NULL, NULL),
	('20251230074750', '{"-- Update favorite fanmark returned notification template for all languages with grace_expires_at

-- English
UPDATE notification_templates
SET 
  body = ''Your favorite fanmark \"{{fanmark_name}}\" is available. Join the lottery by {{grace_expires_at}}!'',
  summary = ''Join the lottery to get your favorite fanmark'',
  updated_at = now()
WHERE template_id = ''4ba5ee3e-4222-4001-9a9f-8e968b36e920''
  AND language = ''en''","-- Korean
UPDATE notification_templates
SET 
  body = ''즐겨찾기한 팬마크 \"{{fanmark_name}}\"가 반환 중입니다. {{grace_expires_at}}까지 추첨에 참여하세요!'',
  summary = ''추첨에 참여하여 재취득 기회를 잡으세요'',
  updated_at = now()
WHERE template_id = ''4ba5ee3e-4222-4001-9a9f-8e968b36e920''
  AND language = ''ko''","-- Indonesian
UPDATE notification_templates
SET 
  body = ''Fanmark favorit Anda \"{{fanmark_name}}\" sedang dikembalikan. Ikuti undian sebelum {{grace_expires_at}}!'',
  summary = ''Ikuti undian untuk mendapatkan fanmark favorit Anda'',
  updated_at = now()
WHERE template_id = ''4ba5ee3e-4222-4001-9a9f-8e968b36e920''
  AND language = ''id''"}', '23e48e1a-0112-4eb1-9b23-22996f7b5114', NULL, NULL, NULL),
	('20251230075219', '{"-- Update fanmark_returned_owner notification template for all languages

-- Japanese
UPDATE notification_templates
SET 
  body = ''ファンマーク「{{fanmark_name}}」を返却しました。{{grace_expires_at}}に失効します。失効するとファンマアクセスの設定は削除されます。'',
  updated_at = now()
WHERE template_id = ''a1b2c3d4-e5f6-7890-abcd-ef1234567890''
  AND language = ''ja''","-- English
UPDATE notification_templates
SET 
  body = ''You have returned fanmark \"{{fanmark_name}}\". It will expire on {{grace_expires_at}}. Your access settings will be deleted upon expiration.'',
  updated_at = now()
WHERE template_id = ''a1b2c3d4-e5f6-7890-abcd-ef1234567890''
  AND language = ''en''","-- Korean
UPDATE notification_templates
SET 
  body = ''팬마크 \"{{fanmark_name}}\"를 반환했습니다. {{grace_expires_at}}에 만료됩니다. 만료되면 액세스 설정이 삭제됩니다.'',
  updated_at = now()
WHERE template_id = ''a1b2c3d4-e5f6-7890-abcd-ef1234567890''
  AND language = ''ko''","-- Indonesian
UPDATE notification_templates
SET 
  body = ''Anda telah mengembalikan fanmark \"{{fanmark_name}}\". Akan kedaluwarsa pada {{grace_expires_at}}. Pengaturan akses Anda akan dihapus saat kedaluwarsa.'',
  updated_at = now()
WHERE template_id = ''a1b2c3d4-e5f6-7890-abcd-ef1234567890''
  AND language = ''id''"}', '9ede201a-7fe6-465b-8b5b-9a9aa1169ee4', NULL, NULL, NULL),
	('20251230091225', '{"-- =========================================
-- Fanmark Transfer Notification Templates & Rules
-- =========================================

-- Template IDs:
-- transfer_requested: b1c2d3e4-f5a6-7890-abcd-111111111111
-- transfer_approved:  b1c2d3e4-f5a6-7890-abcd-222222222222
-- transfer_rejected:  b1c2d3e4-f5a6-7890-abcd-333333333333

-- =========================================
-- 1. transfer_requested templates (4 languages)
-- =========================================

-- Japanese
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-111111111111'',
  1,
  ''in_app'',
  ''ja'',
  ''移管申請を受け付けました'',
  ''「{{fanmark_name}}」の移管申請を{{requester_name}}さんから受け付けました。承認または拒否を選択してください。'',
  ''移管申請受付'',
  true
)","-- English
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-111111111111'',
  1,
  ''in_app'',
  ''en'',
  ''Transfer Request Received'',
  ''You received a transfer request for \"{{fanmark_name}}\" from {{requester_name}}. Please approve or reject the request.'',
  ''Transfer request received'',
  true
)","-- Korean
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-111111111111'',
  1,
  ''in_app'',
  ''ko'',
  ''이전 신청을 받았습니다'',
  ''{{requester_name}}님으로부터 \"{{fanmark_name}}\"의 이전 신청을 받았습니다. 승인 또는 거부를 선택해 주세요.'',
  ''이전 신청 접수'',
  true
)","-- Indonesian
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-111111111111'',
  1,
  ''in_app'',
  ''id'',
  ''Permintaan Transfer Diterima'',
  ''Anda menerima permintaan transfer untuk \"{{fanmark_name}}\" dari {{requester_name}}. Silakan setujui atau tolak permintaan.'',
  ''Permintaan transfer diterima'',
  true
)","-- =========================================
-- 2. transfer_approved templates (4 languages)
-- =========================================

-- Japanese
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-222222222222'',
  1,
  ''in_app'',
  ''ja'',
  ''移管申請が承認されました'',
  ''ファンマーク「{{fanmark_name}}」の移管申請が承認されました。{{license_end}}まで有効です。'',
  ''移管承認'',
  true
)","-- English
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-222222222222'',
  1,
  ''in_app'',
  ''en'',
  ''Transfer Request Approved'',
  ''Your transfer request for \"{{fanmark_name}}\" has been approved. Valid until {{license_end}}.'',
  ''Transfer approved'',
  true
)","-- Korean
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-222222222222'',
  1,
  ''in_app'',
  ''ko'',
  ''이전 신청이 승인되었습니다'',
  ''팬마크 \"{{fanmark_name}}\" 이전 신청이 승인되었습니다. {{license_end}}까지 유효합니다.'',
  ''이전 승인'',
  true
)","-- Indonesian
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-222222222222'',
  1,
  ''in_app'',
  ''id'',
  ''Permintaan Transfer Disetujui'',
  ''Permintaan transfer Anda untuk \"{{fanmark_name}}\" telah disetujui. Berlaku hingga {{license_end}}.'',
  ''Transfer disetujui'',
  true
)","-- =========================================
-- 3. transfer_rejected templates (4 languages)
-- =========================================

-- Japanese
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-333333333333'',
  1,
  ''in_app'',
  ''ja'',
  ''移管申請が拒否されました'',
  ''ファンマーク「{{fanmark_name}}」の移管申請が拒否されました。'',
  ''移管拒否'',
  true
)","-- English
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-333333333333'',
  1,
  ''in_app'',
  ''en'',
  ''Transfer Request Rejected'',
  ''Your transfer request for \"{{fanmark_name}}\" has been rejected.'',
  ''Transfer rejected'',
  true
)","-- Korean
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-333333333333'',
  1,
  ''in_app'',
  ''ko'',
  ''이전 신청이 거부되었습니다'',
  ''팬마크 \"{{fanmark_name}}\" 이전 신청이 거부되었습니다.'',
  ''이전 거부'',
  true
)","-- Indonesian
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  ''b1c2d3e4-f5a6-7890-abcd-333333333333'',
  1,
  ''in_app'',
  ''id'',
  ''Permintaan Transfer Ditolak'',
  ''Permintaan transfer Anda untuk \"{{fanmark_name}}\" telah ditolak.'',
  ''Transfer ditolak'',
  true
)","-- =========================================
-- 4. Notification Rules (3 rules) - priority 1-10 range
-- =========================================

-- Rule for transfer_requested
INSERT INTO notification_rules (event_type, template_id, template_version, channel, priority, delay_seconds, enabled)
VALUES (
  ''transfer_requested'',
  ''b1c2d3e4-f5a6-7890-abcd-111111111111'',
  1,
  ''in_app'',
  8,
  0,
  true
)","-- Rule for transfer_approved
INSERT INTO notification_rules (event_type, template_id, template_version, channel, priority, delay_seconds, enabled)
VALUES (
  ''transfer_approved'',
  ''b1c2d3e4-f5a6-7890-abcd-222222222222'',
  1,
  ''in_app'',
  8,
  0,
  true
)","-- Rule for transfer_rejected
INSERT INTO notification_rules (event_type, template_id, template_version, channel, priority, delay_seconds, enabled)
VALUES (
  ''transfer_rejected'',
  ''b1c2d3e4-f5a6-7890-abcd-333333333333'',
  1,
  ''in_app'',
  8,
  0,
  true
)"}', 'b3595f0a-f3da-4f73-8f8c-7df67f83aac3', NULL, NULL, NULL),
	('20251230120000', '{"-- Fix render_notification_template to skip NULL payload values
-- Prevents NULL replacement from wiping title/body/summary

CREATE OR REPLACE FUNCTION public.render_notification_template(
  template_id_param uuid,
  template_version_param integer,
  payload_param jsonb,
  language_param text DEFAULT ''ja''::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''public''
AS $function$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
  payload_value text;
  datetime_keys text[] := ARRAY[''grace_expires_at'', ''license_end'', ''expires_at'', ''created_at'', ''updated_at''];
BEGIN
  SELECT title, body, summary
  INTO template_record
  FROM public.notification_templates
  WHERE template_id = template_id_param
    AND version = template_version_param
    AND language = language_param
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''Template not found: % version % language %'',
      template_id_param, template_version_param, language_param;
  END IF;

  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    IF NOT (key_name = ANY(datetime_keys)) THEN
      payload_value := payload_param->>key_name;
      IF payload_value IS NOT NULL THEN
        rendered_title := REPLACE(rendered_title, ''{{'' || key_name || ''}}'', payload_value);
        rendered_body := REPLACE(rendered_body, ''{{'' || key_name || ''}}'', payload_value);
        IF rendered_summary IS NOT NULL THEN
          rendered_summary := REPLACE(rendered_summary, ''{{'' || key_name || ''}}'', payload_value);
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    ''title'', rendered_title,
    ''body'', rendered_body,
    ''summary'', rendered_summary,
    ''metadata'', payload_param
  );
END;
$function$"}', 'fix_render_notification_template_nulls', NULL, NULL, NULL);


--
-- Data for Name: seed_files; Type: TABLE DATA; Schema: supabase_migrations; Owner: postgres
--



--
-- PostgreSQL database dump complete
--

-- \unrestrict obXABgOhyNw1Rdf8RA8b2IuhgIGK4IenDUpttiCPPiSdZnb24ItaNsnOjV4EfYu

RESET ALL;
