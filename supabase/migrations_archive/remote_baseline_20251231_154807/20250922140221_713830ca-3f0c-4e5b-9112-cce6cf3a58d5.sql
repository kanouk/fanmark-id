-- Fix security issue: Remove public access to sensitive fanmark data
DROP POLICY IF EXISTS "Anyone can view active fanmarks" ON public.fanmarks;

-- Create a secure function that returns only essential data for public emoji access
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
    AND f.status = 'active'
  LIMIT 1;
$$;

-- Grant execute permission to anonymous users for emoji access
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO authenticated;