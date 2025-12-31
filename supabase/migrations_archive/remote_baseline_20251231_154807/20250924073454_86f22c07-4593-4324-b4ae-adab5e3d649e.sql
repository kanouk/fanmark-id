-- Rename fanmarks.display_name to fanmarks.fanmark_name for better clarity
ALTER TABLE public.fanmarks 
RENAME COLUMN display_name TO fanmark_name;

-- Add comment to clarify the concept
COMMENT ON COLUMN public.fanmarks.fanmark_name IS 'ファンマーク自体の名前（内部管理用）';