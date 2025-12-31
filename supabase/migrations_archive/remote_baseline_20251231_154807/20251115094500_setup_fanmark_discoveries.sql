-- Set up canonical key function, discovery catalog, favorites, and event logging for fanmarks

-- Ensure pgcrypto extension is available for deterministic hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Deterministic sequence key derived from normalized emoji UUID array
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
    RAISE EXCEPTION 'normalized_ids cannot be null or empty';
  END IF;

  hash_bytes := digest(array_to_string(normalized_ids, ','), 'sha1');
  hex := encode(hash_bytes, 'hex');

  RETURN (
    substr(hex, 1, 8) || '-' ||
    substr(hex, 9, 4) || '-' ||
    substr(hex, 13, 4) || '-' ||
    substr(hex, 17, 4) || '-' ||
    substr(hex, 21, 12)
  )::uuid;
END;
$function$;

-- Add unique constraint on fanmarks using canonical sequence key
CREATE UNIQUE INDEX IF NOT EXISTS fanmarks_seq_key_idx
ON public.fanmarks (seq_key(normalized_emoji_ids));

-- Drop legacy favorites table to replace with new structure
DROP TABLE IF EXISTS public.fanmark_favorites;

-- Catalog for discovered fanmarks (observed via search/favorite), including unclaimed ones
CREATE TABLE public.fanmark_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emoji_ids uuid[] NOT NULL,
  normalized_emoji_ids uuid[] NOT NULL,
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE SET NULL,
  availability_status text NOT NULL DEFAULT 'unknown',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  search_count bigint NOT NULL DEFAULT 0,
  favorite_count bigint NOT NULL DEFAULT 0,
  CONSTRAINT fanmark_discoveries_availability_check
    CHECK (availability_status IN ('unknown', 'unclaimed', 'claimed_external', 'owned_by_user'))
);

CREATE UNIQUE INDEX fanmark_discoveries_seq_key_idx
ON public.fanmark_discoveries (seq_key(normalized_emoji_ids));

CREATE INDEX fanmark_discoveries_fanmark_idx
ON public.fanmark_discoveries (fanmark_id);

CREATE INDEX fanmark_discoveries_last_seen_idx
ON public.fanmark_discoveries (last_seen_at DESC);

-- Favorites table referencing discovery catalog and optionally concrete fanmark
CREATE TABLE public.fanmark_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  discovery_id uuid NOT NULL REFERENCES public.fanmark_discoveries(id) ON DELETE CASCADE,
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE SET NULL,
  normalized_emoji_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX fanmark_favorites_user_seq_idx
ON public.fanmark_favorites (user_id, seq_key(normalized_emoji_ids));

CREATE INDEX fanmark_favorites_user_idx
ON public.fanmark_favorites (user_id);

CREATE INDEX fanmark_favorites_fanmark_idx
ON public.fanmark_favorites (fanmark_id);

-- Optional event log for analytics / auditing
CREATE TABLE public.fanmark_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  user_id uuid,
  discovery_id uuid REFERENCES public.fanmark_discoveries(id) ON DELETE SET NULL,
  normalized_emoji_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fanmark_events_type_created_idx
ON public.fanmark_events (event_type, created_at DESC);

-- Enable and configure RLS policies
ALTER TABLE public.fanmark_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_events ENABLE ROW LEVEL SECURITY;

-- Allow all users to read discovery catalog (writes go through security definer RPCs)
DROP POLICY IF EXISTS "Allow read discoveries" ON public.fanmark_discoveries;
CREATE POLICY "Allow read discoveries"
ON public.fanmark_discoveries
FOR SELECT
USING (true);

-- Allow authenticated users to manage their own favorites
DROP POLICY IF EXISTS "Users manage favorites" ON public.fanmark_favorites;
CREATE POLICY "Users manage favorites"
ON public.fanmark_favorites
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Restrict events table to service/admin roles (no public access)
DROP POLICY IF EXISTS "Allow read events" ON public.fanmark_events;
CREATE POLICY "Allow read events"
ON public.fanmark_events
FOR SELECT
USING (auth.role() = 'service_role' OR is_admin());
