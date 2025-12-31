-- Add composite unique constraint to fanmark_profiles table
-- This ensures one user can only have one profile per fanmark
-- and enables the upsert operation in useEmojiProfile.tsx to work correctly

ALTER TABLE public.fanmark_profiles 
ADD CONSTRAINT fanmark_profiles_fanmark_id_user_id_unique 
UNIQUE (fanmark_id, user_id);