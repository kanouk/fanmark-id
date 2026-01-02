-- Create languages table for dynamic language management
CREATE TABLE public.languages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  native_label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;

-- Public read access (languages are public info)
CREATE POLICY "Languages are publicly readable"
ON public.languages
FOR SELECT
USING (true);

-- Admin-only write access
CREATE POLICY "Only admins can modify languages"
ON public.languages
FOR ALL
USING (public.is_admin());

-- Add trigger for updated_at
CREATE TRIGGER update_languages_updated_at
BEFORE UPDATE ON public.languages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert current active languages
INSERT INTO public.languages (code, label, native_label, is_active, sort_order) VALUES
  ('ja', 'Japanese', '日本語', true, 1),
  ('en', 'English', 'English', true, 2),
  ('ko', 'Korean', '한국어', true, 3),
  ('id', 'Indonesian', 'Bahasa Indonesia', true, 4);

-- Create index for faster lookups
CREATE INDEX idx_languages_active ON public.languages (is_active, sort_order);