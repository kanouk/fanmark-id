-- Read-only aggregate preflight for the initial public API response bounds.
-- Run with an already-authorized role that can read all referenced tables.
-- This script does not grant privileges or select a role automatically.
-- Keep results private. A true result is only a point-in-time observation;
-- it neither constrains future writes nor proves full response compatibility.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
 'readOnly', current_setting('transaction_read_only'),
 'namesWithin256Bytes', (SELECT coalesce(bool_and(fanmark_name IS NULL OR octet_length(fanmark_name)<=256),true) FROM public.fanmark_basic_configs),
 'textWithin16KiB', (SELECT coalesce(bool_and(content IS NULL OR octet_length(content)<=16384),true) FROM public.fanmark_messageboard_configs),
 'redirectWithin2048Bytes', (SELECT coalesce(bool_and(target_url IS NULL OR octet_length(target_url)<=2048),true) FROM public.fanmark_redirect_configs),
 'shortIdWithin256Bytes', (SELECT coalesce(bool_and(short_id IS NULL OR octet_length(short_id)<=256),true) FROM public.fanmarks),
 'socialJsonWithin16KiB', (SELECT coalesce(bool_and(social_links IS NULL OR octet_length(social_links::text)<=16384),true) FROM public.fanmark_profiles),
 'themeJsonWithin16KiB', (SELECT coalesce(bool_and(theme_settings IS NULL OR octet_length(theme_settings::text)<=16384),true) FROM public.fanmark_profiles)
);
ROLLBACK;
