-- Create fanmark availability rules table for pattern-based pricing
CREATE TABLE public.fanmark_availability_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('specific_pattern', 'duplicate_pattern', 'prefix_pattern', 'count_based')),
  priority INTEGER NOT NULL CHECK (priority >= 1 AND priority <= 4),
  rule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_available BOOLEAN NOT NULL DEFAULT true,
  price_usd DECIMAL(10,2),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.fanmark_availability_rules ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view active availability rules" 
ON public.fanmark_availability_rules 
FOR SELECT 
USING (is_available = true);

CREATE POLICY "Only admins can manage availability rules" 
ON public.fanmark_availability_rules 
FOR ALL 
USING (is_admin());

-- Create index for performance
CREATE INDEX idx_fanmark_availability_rules_type_priority ON public.fanmark_availability_rules(rule_type, priority);
CREATE INDEX idx_fanmark_availability_rules_available ON public.fanmark_availability_rules(is_available) WHERE is_available = true;

-- Create trigger for updated_at
CREATE TRIGGER update_fanmark_availability_rules_updated_at
BEFORE UPDATE ON public.fanmark_availability_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default rules
INSERT INTO public.fanmark_availability_rules (rule_type, priority, rule_config, price_usd, description) VALUES
('specific_pattern', 1, '{"patterns": ["🎄", "🏢", "💎"]}', 99.99, 'Specific reserved patterns'),
('duplicate_pattern', 2, '{"enabled": true}', 19.99, 'Consecutive duplicate emojis'),
('prefix_pattern', 3, '{"prefixes": {"🎄": 5.99, "🏢": 29.99, "💎": 19.99}}', null, 'Prefix-based pricing'),
('count_based', 4, '{"pricing": {"1": 0.99, "2": 4.99, "3": 9.99, "4": 19.99, "5": 39.99}}', null, 'Count-based default pricing');