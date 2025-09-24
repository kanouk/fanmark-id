-- Ensure unique (fanmark_id, user_id) for emoji_profiles and clean duplicates
BEGIN;

-- 1) Remove duplicate rows, keeping the most recently updated per (fanmark_id, user_id)
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
  AND r.rn > 1;

-- 2) Add unique constraint to support ON CONFLICT upserts
ALTER TABLE public.emoji_profiles
ADD CONSTRAINT emoji_profiles_fanmark_user_unique UNIQUE (fanmark_id, user_id);

COMMIT;