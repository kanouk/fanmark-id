-- Create extension_coupons table (coupon master)
CREATE TABLE public.extension_coupons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  months smallint NOT NULL CHECK (months IN (1, 2, 3, 6)),
  allowed_tier_levels smallint[] DEFAULT NULL,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamp with time zone DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create extension_coupon_usages table (usage history)
CREATE TABLE public.extension_coupon_usages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id uuid NOT NULL REFERENCES extension_coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  fanmark_id uuid NOT NULL REFERENCES fanmarks(id),
  license_id uuid NOT NULL REFERENCES fanmark_licenses(id),
  used_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_extension_coupons_code ON extension_coupons(code);
CREATE INDEX idx_extension_coupons_active ON extension_coupons(is_active) WHERE is_active = true;
CREATE INDEX idx_extension_coupon_usages_coupon_id ON extension_coupon_usages(coupon_id);
CREATE INDEX idx_extension_coupon_usages_user_id ON extension_coupon_usages(user_id);

-- Enable RLS
ALTER TABLE public.extension_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extension_coupon_usages ENABLE ROW LEVEL SECURITY;

-- RLS policies for extension_coupons
CREATE POLICY "Admins can manage all coupons"
ON public.extension_coupons
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "Authenticated users can validate active coupons"
ON public.extension_coupons
FOR SELECT
USING (
  auth.uid() IS NOT NULL 
  AND is_active = true 
  AND (expires_at IS NULL OR expires_at > now())
  AND used_count < max_uses
);

-- RLS policies for extension_coupon_usages
CREATE POLICY "Admins can manage all usages"
ON public.extension_coupon_usages
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "System can insert usages"
ON public.extension_coupon_usages
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users can view their own usages"
ON public.extension_coupon_usages
FOR SELECT
USING (auth.uid() = user_id);

-- Create trigger for updated_at on extension_coupons
CREATE TRIGGER update_extension_coupons_updated_at
BEFORE UPDATE ON public.extension_coupons
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();