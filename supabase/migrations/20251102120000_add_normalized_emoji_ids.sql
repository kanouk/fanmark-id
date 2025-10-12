-- Introduce normalized_emoji_ids for ID-based normalization lookups

ALTER TABLE public.fanmarks
  ADD COLUMN IF NOT EXISTS normalized_emoji_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- Seed the new column for existing rows (development environments can wipe data,
-- but this keeps forward migrations consistent).
UPDATE public.fanmarks
SET normalized_emoji_ids = COALESCE(normalized_emoji_ids, '{}'::uuid[])
WHERE normalized_emoji_ids IS NULL;

UPDATE public.fanmarks
SET normalized_emoji_ids = emoji_ids
WHERE (normalized_emoji_ids = '{}'::uuid[] OR normalized_emoji_ids IS NULL)
  AND emoji_ids IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fanmarks_normalized_emoji_ids
  ON public.fanmarks USING gin (normalized_emoji_ids);

ALTER TABLE public.fanmarks
  DROP CONSTRAINT IF EXISTS fanmarks_emoji_combination_unique;

ALTER TABLE public.fanmarks
  ADD CONSTRAINT fanmarks_normalized_emoji_ids_unique UNIQUE (normalized_emoji_ids);
