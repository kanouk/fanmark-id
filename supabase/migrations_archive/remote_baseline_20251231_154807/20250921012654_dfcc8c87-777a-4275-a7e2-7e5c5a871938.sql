-- Add new columns to fanmarks table for registration system
ALTER TABLE public.fanmarks 
ADD COLUMN access_type text NOT NULL DEFAULT 'inactive',
ADD COLUMN target_url text,
ADD COLUMN text_content text,
ADD COLUMN display_name text,
ADD COLUMN is_transferable boolean NOT NULL DEFAULT true;

-- Add check constraint for access_type
ALTER TABLE public.fanmarks 
ADD CONSTRAINT check_access_type 
CHECK (access_type IN ('profile', 'redirect', 'text', 'inactive'));

-- Create emoji_profiles table for profile pages
CREATE TABLE public.emoji_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fanmark_id uuid NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  bio text,
  social_links jsonb DEFAULT '{}',
  theme_settings jsonb DEFAULT '{}',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on emoji_profiles
ALTER TABLE public.emoji_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for emoji_profiles
CREATE POLICY "Users can view public emoji profiles"
ON public.emoji_profiles
FOR SELECT
USING (is_public = true);

CREATE POLICY "Users can manage their own emoji profiles"
ON public.emoji_profiles
FOR ALL
USING (auth.uid() = user_id);

-- Add trigger for updated_at on emoji_profiles
CREATE TRIGGER update_emoji_profiles_updated_at
BEFORE UPDATE ON public.emoji_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for performance
CREATE INDEX idx_emoji_profiles_fanmark_id ON public.emoji_profiles(fanmark_id);
CREATE INDEX idx_emoji_profiles_user_id ON public.emoji_profiles(user_id);