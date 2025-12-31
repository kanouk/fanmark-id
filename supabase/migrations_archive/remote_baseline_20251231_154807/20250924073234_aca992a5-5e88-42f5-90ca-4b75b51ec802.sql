-- Add display_name column to emoji_profiles table
ALTER TABLE public.emoji_profiles 
ADD COLUMN display_name text;

-- Add comment to clarify the concept difference
COMMENT ON COLUMN public.emoji_profiles.display_name IS 'プロフィール編集画面での表示名（fanmarks.display_nameとは別概念）';