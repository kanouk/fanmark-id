-- Add display_order column to fanmarks for custom ordering
ALTER TABLE public.fanmarks
  ADD COLUMN IF NOT EXISTS display_order integer;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) - 1 AS rn
  FROM public.fanmarks
)
UPDATE public.fanmarks f
SET display_order = ranked.rn
FROM ranked
WHERE f.id = ranked.id
  AND (f.display_order IS NULL OR f.display_order <> ranked.rn);

ALTER TABLE public.fanmarks
  ALTER COLUMN display_order SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_fanmarks_user_display_order
  ON public.fanmarks (user_id, display_order);
