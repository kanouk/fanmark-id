-- Allow active licenses with no end date (tier C) to update password configs
CREATE OR REPLACE FUNCTION public.upsert_fanmark_password_config(
  license_uuid uuid,
  new_password text,
  enable_password boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    config_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM public.fanmark_licenses fl
        WHERE fl.id = license_uuid 
          AND fl.user_id = auth.uid() 
          AND fl.status = 'active' 
          AND (fl.license_end IS NULL OR fl.license_end > now())
    ) THEN
        RAISE EXCEPTION 'Unauthorized: User does not have active license';
    END IF;

    INSERT INTO public.fanmark_password_configs (
        license_id,
        access_password,
        is_enabled
    ) VALUES (
        license_uuid,
        new_password,
        enable_password
    )
    ON CONFLICT (license_id) DO UPDATE SET
        access_password = EXCLUDED.access_password,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = now()
    RETURNING id INTO config_id;
    
    RETURN config_id;
END;
$function$;
