-- Security Fix: Prevent email exposure in public profiles

-- Step 1: Create a function to generate safe display names
CREATE OR REPLACE FUNCTION public.generate_safe_display_name(user_email TEXT, user_id UUID)
RETURNS TEXT AS $$
BEGIN
  -- Extract username part before @ from email, or use user_ + first 8 chars of UUID
  RETURN COALESCE(
    CASE 
      WHEN user_email IS NOT NULL AND user_email LIKE '%@%' THEN 
        split_part(user_email, '@', 1)
      ELSE 
        'user_' || substring(user_id::text, 1, 8)
    END,
    'user_' || substring(user_id::text, 1, 8)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Step 2: Update existing profiles that have email addresses as display names
UPDATE public.profiles 
SET display_name = public.generate_safe_display_name(display_name, user_id)
WHERE display_name LIKE '%@%.%' AND display_name LIKE '%@%';

-- Step 3: Update the handle_new_user function to use safe display names
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    username,
    display_name
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', 'user_' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      public.generate_safe_display_name(NEW.email, NEW.id)
    )
  );
  RETURN NEW;
END;
$$;

-- Step 4: Fix conflicting RLS policies by dropping conflicting ones and creating a clear policy
DROP POLICY IF EXISTS "Public profiles viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Safe public profile data viewable by everyone" ON public.profiles;

-- Create a single, clear policy for public profile access
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles 
FOR SELECT 
USING (
  -- Users can always see their own profile
  auth.uid() = user_id 
  OR 
  -- Public profiles are viewable by anyone
  (is_public_profile = true)
);

-- Step 5: Add a trigger to prevent email addresses from being set as display names
CREATE OR REPLACE FUNCTION public.validate_display_name()
RETURNS trigger AS $$
BEGIN
  -- Check if display_name looks like an email address
  IF NEW.display_name IS NOT NULL AND NEW.display_name LIKE '%@%.%' THEN
    -- Replace with safe display name
    NEW.display_name = public.generate_safe_display_name(NEW.display_name, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger to validate display names on insert and update
DROP TRIGGER IF EXISTS validate_display_name_trigger ON public.profiles;
CREATE TRIGGER validate_display_name_trigger
  BEFORE INSERT OR UPDATE OF display_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_display_name();