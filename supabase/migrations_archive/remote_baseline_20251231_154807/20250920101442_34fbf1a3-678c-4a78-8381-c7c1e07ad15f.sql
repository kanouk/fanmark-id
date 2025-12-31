-- Create reserved emoji patterns table
CREATE TABLE public.reserved_emoji_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  price_yen INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on reserved emoji patterns
ALTER TABLE public.reserved_emoji_patterns ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view active reserved patterns
CREATE POLICY "Anyone can view active reserved patterns" 
ON public.reserved_emoji_patterns 
FOR SELECT 
USING (is_active = true);

-- Create audit logs table
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can only view their own audit logs
CREATE POLICY "Users can view their own audit logs" 
ON public.audit_logs 
FOR SELECT 
USING (auth.uid() = user_id);

-- Add trigger for updating reserved emoji patterns timestamps
CREATE TRIGGER update_reserved_emoji_patterns_updated_at
BEFORE UPDATE ON public.reserved_emoji_patterns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert some sample reserved emoji patterns
INSERT INTO public.reserved_emoji_patterns (pattern, price_yen, description) VALUES
('🏢', 5000, 'Business building emoji - premium tier'),
('💼', 3000, 'Briefcase emoji - business tier'),
('🏦', 8000, 'Bank emoji - premium tier'),
('🏪', 2000, 'Store emoji - standard tier'),
('🏭', 4000, 'Factory emoji - business tier');

-- Create indexes for performance
CREATE INDEX idx_reserved_emoji_patterns_pattern ON public.reserved_emoji_patterns(pattern);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at);