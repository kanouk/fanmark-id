-- Add emoji_ids column to fanmarks for ID-based emoji handling

ALTER TABLE public.fanmarks
  ADD COLUMN IF NOT EXISTS emoji_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS idx_fanmarks_emoji_ids ON public.fanmarks USING gin (emoji_ids);
