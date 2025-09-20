-- Create fanmarks table for emoji combinations
CREATE TABLE public.fanmarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  emoji_combination TEXT NOT NULL,
  normalized_emoji TEXT NOT NULL,
  short_id TEXT NOT NULL UNIQUE,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT fanmarks_emoji_combination_unique UNIQUE (normalized_emoji),
  CONSTRAINT fanmarks_short_id_length CHECK (char_length(short_id) >= 6),
  CONSTRAINT fanmarks_status_valid CHECK (status IN ('active', 'reserved', 'banned'))
);

-- Enable RLS on fanmarks
ALTER TABLE public.fanmarks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for fanmarks
CREATE POLICY "Anyone can view active fanmarks" 
ON public.fanmarks 
FOR SELECT 
USING (status = 'active');

CREATE POLICY "Users can create their own fanmarks" 
ON public.fanmarks 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own fanmarks" 
ON public.fanmarks 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create invitation_codes table
CREATE TABLE public.invitation_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  special_perks JSONB DEFAULT '{}',
  created_by UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT invitation_codes_code_format CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  CONSTRAINT invitation_codes_max_uses_positive CHECK (max_uses > 0),
  CONSTRAINT invitation_codes_used_count_valid CHECK (used_count >= 0 AND used_count <= max_uses)
);

-- Enable RLS on invitation_codes
ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for invitation_codes (only allow checking validity, not viewing details)
CREATE POLICY "Anyone can validate invitation codes" 
ON public.invitation_codes 
FOR SELECT 
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()) AND used_count < max_uses);

-- Create system_settings table
CREATE TABLE public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT system_settings_key_format CHECK (setting_key ~ '^[a-z_]+$')
);

-- Enable RLS on system_settings
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for system_settings
CREATE POLICY "Anyone can view public settings" 
ON public.system_settings 
FOR SELECT 
USING (is_public = true);

-- Create waitlist table
CREATE TABLE public.waitlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  referral_source TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT waitlist_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT waitlist_status_valid CHECK (status IN ('waiting', 'invited', 'converted'))
);

-- Enable RLS on waitlist
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for waitlist (users can only add themselves)
CREATE POLICY "Anyone can join waitlist" 
ON public.waitlist 
FOR INSERT 
WITH CHECK (true);

-- Add invitation tracking to profiles table
ALTER TABLE public.profiles 
ADD COLUMN invited_by_code TEXT,
ADD COLUMN invitation_perks JSONB DEFAULT '{}';

-- Create indexes for performance
CREATE INDEX idx_fanmarks_normalized_emoji ON public.fanmarks(normalized_emoji);
CREATE INDEX idx_fanmarks_user_id ON public.fanmarks(user_id);
CREATE INDEX idx_fanmarks_status ON public.fanmarks(status);
CREATE INDEX idx_invitation_codes_code ON public.invitation_codes(code);
CREATE INDEX idx_invitation_codes_active ON public.invitation_codes(is_active, expires_at);
CREATE INDEX idx_system_settings_key ON public.system_settings(setting_key);
CREATE INDEX idx_waitlist_email ON public.waitlist(email);

-- Insert default system settings
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public) VALUES
('invitation_mode', 'false', 'Whether the system is in invitation-only mode', true),
('max_fanmarks_per_user', '10', 'Maximum fanmarks a user can create', true),
('premium_pricing', '1000', 'Price for premium fanmarks in yen', true);

-- Create triggers for updated_at
CREATE TRIGGER update_fanmarks_updated_at
  BEFORE UPDATE ON public.fanmarks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_invitation_codes_updated_at
  BEFORE UPDATE ON public.invitation_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();