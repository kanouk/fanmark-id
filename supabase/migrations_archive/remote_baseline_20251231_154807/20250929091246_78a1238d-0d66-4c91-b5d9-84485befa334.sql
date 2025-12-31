-- Create fanmark_favorites table for bookmark functionality
CREATE TABLE public.fanmark_favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fanmark_id UUID NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, fanmark_id)
);

-- Enable RLS
ALTER TABLE public.fanmark_favorites ENABLE ROW LEVEL SECURITY;

-- Create policies for fanmark_favorites
CREATE POLICY "Users can manage their own favorites" 
ON public.fanmark_favorites 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create comprehensive fanmark details function
CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  -- Basic fanmark info
  fanmark_id uuid,
  emoji_combination text,
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  
  -- Current license info
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  is_currently_active boolean,
  
  -- First acquisition info
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  
  -- History data (JSON array)
  license_history jsonb,
  
  -- Favorite status for current user
  is_favorited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  
  -- Get fanmark basic info
  SELECT f.id, f.emoji_combination, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = 'active';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH current_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end,
      (fl.status = 'active' AND fl.license_end > now()) as is_active
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
      AND fl.status = 'active' 
      AND fl.license_end > now()
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          'license_start', fl.license_start,
          'license_end', fl.license_end,
          'username', us.username,
          'display_name', us.display_name,
          'status', fl.status,
          'is_initial_license', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.emoji_combination,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    cl.license_id,
    cl.username,
    cl.display_name,
    cl.license_start,
    cl.license_end,
    COALESCE(cl.is_active, false),
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, '[]'::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM current_license cl
  CROSS JOIN first_license fl
  CROSS JOIN history h
  CROSS JOIN favorite_status fs;
END;
$$;

-- Create function to toggle favorites
CREATE OR REPLACE FUNCTION public.toggle_fanmark_favorite(fanmark_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_user_id uuid;
  is_favorited boolean;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;
  
  -- Check if already favorited
  SELECT EXISTS(
    SELECT 1 FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id
  ) INTO is_favorited;
  
  IF is_favorited THEN
    -- Remove favorite
    DELETE FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id;
    RETURN false;
  ELSE
    -- Add favorite
    INSERT INTO public.fanmark_favorites (fanmark_id, user_id) 
    VALUES (fanmark_uuid, current_user_id);
    RETURN true;
  END IF;
END;
$$;