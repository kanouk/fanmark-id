-- Add invited_by_code column to user_settings table
ALTER TABLE public.user_settings 
ADD COLUMN invited_by_code TEXT 
REFERENCES public.invitation_codes(code);

-- Create index for performance
CREATE INDEX idx_user_settings_invited_by_code 
ON public.user_settings(invited_by_code) 
WHERE invited_by_code IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.user_settings.invited_by_code IS 'Invitation code used during signup';
