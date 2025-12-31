-- =====================================================
-- Fanmark Transfer System - Database Schema
-- =====================================================

-- 1. Add is_transferred column to fanmark_licenses
ALTER TABLE public.fanmark_licenses
ADD COLUMN IF NOT EXISTS is_transferred boolean NOT NULL DEFAULT false;

-- 2. Create fanmark_transfer_codes table
CREATE TABLE public.fanmark_transfer_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_id uuid NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  issuer_user_id uuid NOT NULL,
  transfer_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  disclaimer_agreed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_transfer_code_status CHECK (status IN ('active', 'applied', 'completed', 'cancelled', 'expired'))
);

-- 3. Create fanmark_transfer_requests table
CREATE TABLE public.fanmark_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_code_id uuid NOT NULL REFERENCES public.fanmark_transfer_codes(id) ON DELETE CASCADE,
  license_id uuid NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_id uuid NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  disclaimer_agreed_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_transfer_request_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'))
);

-- 4. Create indexes
CREATE INDEX idx_transfer_codes_license_id ON public.fanmark_transfer_codes(license_id);
CREATE INDEX idx_transfer_codes_fanmark_id ON public.fanmark_transfer_codes(fanmark_id);
CREATE INDEX idx_transfer_codes_issuer_user_id ON public.fanmark_transfer_codes(issuer_user_id);
CREATE INDEX idx_transfer_codes_status ON public.fanmark_transfer_codes(status);
CREATE INDEX idx_transfer_codes_transfer_code ON public.fanmark_transfer_codes(transfer_code);

CREATE INDEX idx_transfer_requests_transfer_code_id ON public.fanmark_transfer_requests(transfer_code_id);
CREATE INDEX idx_transfer_requests_license_id ON public.fanmark_transfer_requests(license_id);
CREATE INDEX idx_transfer_requests_fanmark_id ON public.fanmark_transfer_requests(fanmark_id);
CREATE INDEX idx_transfer_requests_requester_user_id ON public.fanmark_transfer_requests(requester_user_id);
CREATE INDEX idx_transfer_requests_status ON public.fanmark_transfer_requests(status);

-- 5. Enable RLS
ALTER TABLE public.fanmark_transfer_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_transfer_requests ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for fanmark_transfer_codes

-- Issuers can view their own codes
CREATE POLICY "Issuers can view their own transfer codes"
ON public.fanmark_transfer_codes
FOR SELECT
USING (auth.uid() = issuer_user_id);

-- Authenticated users can view active codes for validation (limited fields via function)
CREATE POLICY "Authenticated users can validate transfer codes"
ON public.fanmark_transfer_codes
FOR SELECT
USING (auth.uid() IS NOT NULL AND status = 'active');

-- Issuers can cancel their active codes
CREATE POLICY "Issuers can cancel their active transfer codes"
ON public.fanmark_transfer_codes
FOR UPDATE
USING (auth.uid() = issuer_user_id AND status = 'active')
WITH CHECK (status = 'cancelled');

-- System/Admin can manage all codes
CREATE POLICY "System can manage all transfer codes"
ON public.fanmark_transfer_codes
FOR ALL
USING (auth.role() = 'service_role' OR is_admin());

-- 7. RLS Policies for fanmark_transfer_requests

-- Requesters can view their own requests
CREATE POLICY "Requesters can view their own transfer requests"
ON public.fanmark_transfer_requests
FOR SELECT
USING (auth.uid() = requester_user_id);

-- Code issuers can view requests for their codes
CREATE POLICY "Issuers can view requests for their codes"
ON public.fanmark_transfer_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.fanmark_transfer_codes tc
    WHERE tc.id = fanmark_transfer_requests.transfer_code_id
    AND tc.issuer_user_id = auth.uid()
  )
);

-- System/Admin can manage all requests
CREATE POLICY "System can manage all transfer requests"
ON public.fanmark_transfer_requests
FOR ALL
USING (auth.role() = 'service_role' OR is_admin());

-- 8. Create updated_at triggers
CREATE TRIGGER update_fanmark_transfer_codes_updated_at
BEFORE UPDATE ON public.fanmark_transfer_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fanmark_transfer_requests_updated_at
BEFORE UPDATE ON public.fanmark_transfer_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Create helper function to check if license has active transfer
CREATE OR REPLACE FUNCTION public.has_active_transfer(license_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fanmark_transfer_codes
    WHERE license_id = license_uuid
    AND status IN ('active', 'applied')
  );
$$;

-- 10. Create function to generate transfer code
CREATE OR REPLACE FUNCTION public.generate_transfer_code_string()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || '-';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || '-';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;