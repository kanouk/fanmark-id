


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'moderator',
    'user'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."user_language" AS ENUM (
    'en',
    'ja',
    'ko',
    'id'
);


ALTER TYPE "public"."user_language" OWNER TO "postgres";


CREATE TYPE "public"."user_plan" AS ENUM (
    'free',
    'creator',
    'max',
    'business',
    'enterprise',
    'admin'
);


ALTER TYPE "public"."user_plan" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'user',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_fanmark_favorite"("input_emoji_ids" "uuid"[]) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  SELECT fanmark_id INTO linked_fanmark_id
  FROM public.fanmark_discoveries
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids
  )
  VALUES (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids
  )
  ON CONFLICT (user_id, seq_key(normalized_emoji_ids))
  DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = favorite_count + 1
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_add', auth_user_id, discovery_id, normalized_ids);

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."add_fanmark_favorite"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_old_notifications"("days_old" integer DEFAULT 90) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  archived_count integer;
  cutoff_date timestamptz;
BEGIN
  cutoff_date := now() - (days_old || ' days')::interval;

  -- Move to history table
  WITH archived AS (
    DELETE FROM public.notifications
    WHERE created_at < cutoff_date
      AND status IN ('delivered', 'failed')
    RETURNING id, jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'event_id', event_id,
      'rule_id', rule_id,
      'template_id', template_id,
      'template_version', template_version,
      'channel', channel,
      'status', status,
      'payload', payload,
      'priority', priority,
      'triggered_at', triggered_at,
      'delivered_at', delivered_at,
      'read_at', read_at,
      'read_via', read_via,
      'expires_at', expires_at,
      'retry_count', retry_count,
      'error_reason', error_reason,
      'created_at', created_at,
      'updated_at', updated_at
    ) as original_data
  )
  INSERT INTO public.notifications_history (id, original_data)
  SELECT id, original_data FROM archived;

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  RETURN archived_count;
END;
$$;


ALTER FUNCTION "public"."archive_old_notifications"("days_old" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_fanmark_availability"("input_emoji_ids" "uuid"[]) RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_emoji_ids');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'tier_display_name', tier_info.display_name,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = 'grace' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = 'grace' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = 'grace' THEN 'grace_period'
      ELSE 'taken'
    END;
  END IF;

  RETURN json_build_object(
    'available', is_available,
    'fanmark_id', fanmark_record.id,
    'reason', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    'available_at', available_at,
    'blocking_status', blocking_status
  );
END;
$$;


ALTER FUNCTION "public"."check_fanmark_availability"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_fanmark_availability_secure"("fanmark_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid
      AND (
        (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
        OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
      )
  );
END;
$$;


ALTER FUNCTION "public"."check_fanmark_availability_secure"("fanmark_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_username_availability_secure"("username_to_check" "text", "current_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Return false if username is empty
  IF username_to_check IS NULL OR username_to_check = '' THEN
    RETURN false;
  END IF;
  
  -- Check if username exists for a different user
  RETURN NOT EXISTS (
    SELECT 1 
    FROM public.user_settings
    WHERE username = lower(username_to_check)
      AND user_id != COALESCE(current_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
END;
$$;


ALTER FUNCTION "public"."check_username_availability_secure"("username_to_check" "text", "current_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_username_availability_secure"("username_to_check" "text", "current_user_id" "uuid") IS 'Securely checks if a username is available without exposing other users data. Returns true if available, false if taken.';



CREATE OR REPLACE FUNCTION "public"."classify_fanmark_tier"("input_emoji_ids" "uuid"[]) RETURNS TABLE("tier_level" integer, "display_name" "text", "initial_license_days" integer, "monthly_price_usd" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  normalized_ids uuid[];
  emoji_count integer;
  unique_count integer;
  candidate_tier integer;
  tier_record RECORD;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := input_emoji_ids;
  emoji_count := array_length(normalized_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT id) INTO unique_count
  FROM unnest(normalized_ids) AS t(id);

  IF emoji_count = 1 THEN
    candidate_tier := 4;
  ELSIF unique_count = 1 AND emoji_count BETWEEN 2 AND 5 THEN
    candidate_tier := 3;
  ELSIF emoji_count >= 4 THEN
    candidate_tier := 1;
  ELSIF emoji_count = 3 THEN
    candidate_tier := 2;
  ELSIF emoji_count = 2 THEN
    candidate_tier := 3;
  ELSE
    candidate_tier := 1;
  END IF;

  SELECT
    ft.tier_level,
    ft.display_name,
    ft.initial_license_days,
    ft.monthly_price_usd
  INTO tier_record
  FROM public.fanmark_tiers AS ft
  WHERE ft.tier_level = candidate_tier
    AND ft.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    tier_record.tier_level,
    tier_record.display_name,
    tier_record.initial_license_days,
    tier_record.monthly_price_usd;
END;
$$;


ALTER FUNCTION "public"."classify_fanmark_tier"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_fanmark_emoji_units"("input" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  normalized text;
  base_only text;
  zwj_count integer;
BEGIN
  -- Variation Selector と肌色修飾子を除去
  normalized := regexp_replace(
    input,
    format(
      '[%s%s]',
      chr(x'FE0F'::int),
      chr(x'1F3FB'::int) || chr(x'1F3FC'::int) || chr(x'1F3FD'::int) ||
      chr(x'1F3FE'::int) || chr(x'1F3FF'::int)
    ),
    '',
    'g'
  );

  -- ZWJ を数える
  SELECT count(*) INTO zwj_count
  FROM regexp_matches(normalized, chr(x'200D'::int), 'g');

  -- ZWJ を除いたベースの絵文字数を取得
  base_only := regexp_replace(normalized, chr(x'200D'::int), '', 'g');

  RETURN greatest(char_length(base_only) - coalesce(zwj_count, 0), 0);
END;
$$;


ALTER FUNCTION "public"."count_fanmark_emoji_units"("input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notification_event"("event_type_param" "text", "payload_param" "jsonb", "source_param" "text" DEFAULT 'system'::"text", "dedupe_key_param" "text" DEFAULT NULL::"text", "trigger_at_param" timestamp with time zone DEFAULT "now"()) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  event_id uuid;
BEGIN
  -- Check for duplicate if dedupe_key is provided
  IF dedupe_key_param IS NOT NULL THEN
    SELECT id INTO event_id
    FROM public.notification_events
    WHERE dedupe_key = dedupe_key_param
      AND status IN ('pending', 'processing')
    LIMIT 1;

    IF FOUND THEN
      RAISE NOTICE 'Duplicate event found with dedupe_key: %', dedupe_key_param;
      RETURN event_id;
    END IF;
  END IF;

  -- Insert new event
  INSERT INTO public.notification_events (
    event_type,
    payload,
    source,
    dedupe_key,
    trigger_at,
    status
  )
  VALUES (
    event_type_param,
    payload_param,
    source_param,
    dedupe_key_param,
    trigger_at_param,
    'pending'
  )
  RETURNING id INTO event_id;

  RETURN event_id;
END;
$$;


ALTER FUNCTION "public"."create_notification_event"("event_type_param" "text", "payload_param" "jsonb", "source_param" "text", "dedupe_key_param" "text", "trigger_at_param" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_safe_display_name"("user_email" "text", "user_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."generate_safe_display_name"("user_email" "text", "user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_transfer_code_string"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."generate_transfer_code_string"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fanmark_by_emoji"("input_emoji_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "user_input_fanmark" "text", "emoji_ids" "uuid"[], "fanmark_name" "text", "access_type" "text", "target_url" "text", "text_content" "text", "status" "text", "is_password_protected" boolean, "short_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  normalized_ids uuid[];
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    f.short_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = 'active'
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.normalized_emoji_ids = normalized_ids
    AND f.status = 'active';
END;
$$;


ALTER FUNCTION "public"."get_fanmark_by_emoji"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fanmark_by_short_id"("shortid_param" "text") RETURNS TABLE("id" "uuid", "short_id" "text", "user_input_fanmark" "text", "display_fanmark" "text", "emoji_ids" "uuid"[], "fanmark_name" "text", "access_type" "text", "target_url" "text", "text_content" "text", "status" "text", "is_password_protected" boolean, "license_id" "uuid", "license_status" "text", "license_end" timestamp with time zone, "grace_expires_at" timestamp with time zone, "is_returned" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.short_id,
        f.user_input_fanmark,
        fl.display_fanmark,
        f.emoji_ids,
        COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
        COALESCE(bc.access_type, 'inactive') AS access_type,
        rc.target_url,
        mc.content AS text_content,
        f.status,
        COALESCE(pc.is_enabled, false) AS is_password_protected,
        fl.id AS license_id,
        fl.status AS license_status,
        fl.license_end,
        fl.grace_expires_at,
        fl.is_returned
    FROM fanmarks f
    LEFT JOIN LATERAL (
        SELECT fl_inner.*
        FROM fanmark_licenses fl_inner
        WHERE fl_inner.fanmark_id = f.id
          AND fl_inner.status = 'active'
        ORDER BY fl_inner.license_end DESC NULLS LAST
        LIMIT 1
    ) fl ON TRUE
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
      AND f.status = 'active';
END;
$$;


ALTER FUNCTION "public"."get_fanmark_by_short_id"("shortid_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fanmark_complete_data"("fanmark_id_param" "uuid" DEFAULT NULL::"uuid", "emoji_ids_param" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("id" "uuid", "user_input_fanmark" "text", "emoji_ids" "uuid"[], "normalized_emoji" "text", "short_id" "text", "access_type" "text", "status" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "fanmark_name" "text", "target_url" "text", "text_content" "text", "is_password_protected" boolean, "current_owner_id" "uuid", "license_end" timestamp with time zone, "has_active_license" boolean, "license_id" "uuid", "current_license_status" "text", "current_grace_expires_at" timestamp with time zone, "is_blocked_for_registration" boolean, "next_available_at" timestamp with time zone, "lottery_entry_count" bigint, "has_user_lottery_entry" boolean, "user_lottery_entry_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    latest.user_id AS current_owner_id,
    latest.license_end,
    CASE
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      ELSE false
    END AS has_active_license,
    latest.id AS license_id,
    latest.status AS current_license_status,
    latest.grace_expires_at AS current_grace_expires_at,
    CASE
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      WHEN latest.status = 'grace' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN true
      ELSE false
    END AS is_blocked_for_registration,
    CASE
      WHEN latest.status = 'grace' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN COALESCE(latest.grace_expires_at, latest.license_end)
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN latest.license_end
      ELSE NULL
    END AS next_available_at,
    COALESCE(lottery_info.entry_count, 0) AS lottery_entry_count,
    COALESCE(lottery_info.has_entry, false) AS has_user_lottery_entry,
    lottery_info.user_entry_id AS user_lottery_entry_id
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl.*
    FROM fanmark_licenses fl
    WHERE fl.fanmark_id = f.id
    ORDER BY (fl.license_end IS NULL) DESC, fl.license_end DESC
    LIMIT 1
  ) AS latest ON true
  LEFT JOIN fanmark_basic_configs bc ON latest.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON latest.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON latest.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON latest.id = pc.license_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id FROM fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = f.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = 'pending' 
       LIMIT 1) AS user_entry_id
    FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id
      AND fle.entry_status = 'pending'
  ) AS lottery_info ON true
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$$;


ALTER FUNCTION "public"."get_fanmark_complete_data"("fanmark_id_param" "uuid", "emoji_ids_param" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fanmark_details_by_short_id"("shortid_param" "text") RETURNS TABLE("fanmark_id" "uuid", "user_input_fanmark" "text", "emoji_ids" "uuid"[], "normalized_emoji" "text", "short_id" "text", "fanmark_created_at" timestamp with time zone, "current_license_id" "uuid", "current_owner_username" "text", "current_owner_display_name" "text", "current_license_start" timestamp with time zone, "current_license_end" timestamp with time zone, "current_license_status" "text", "current_grace_expires_at" timestamp with time zone, "current_is_returned" boolean, "is_currently_active" boolean, "first_acquired_date" timestamp with time zone, "first_owner_username" "text", "first_owner_display_name" "text", "license_history" "jsonb", "is_favorited" boolean, "lottery_entry_count" bigint, "has_user_lottery_entry" boolean, "user_lottery_entry_id" "uuid", "current_owner_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
    INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param
    AND f.status = 'active';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id AS license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      fl.is_returned,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start AS first_date,
      us.username AS first_username,
      us.display_name AS first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          'license_start', fl.license_start,
          'license_end', fl.license_end,
          'grace_expires_at', fl.grace_expires_at,
          'excluded_at', fl.excluded_at,
          'is_returned', fl.is_returned,
          'username', us.username,
          'display_name', us.display_name,
          'status', fl.status,
          'is_initial_license', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) AS history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.fanmark_favorites ff
      WHERE ff.fanmark_id = fanmark_record.id
        AND ff.user_id = current_user_id
    ) AS is_fav
  ),
  lottery_info AS (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id 
       FROM public.fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = fanmark_record.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = 'pending' 
       LIMIT 1) AS user_entry_id
    FROM public.fanmark_lottery_entries fle
    WHERE fle.fanmark_id = fanmark_record.id
      AND fle.entry_status = 'pending'
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,

    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    ll.is_returned,
    CASE WHEN ll.status = 'active' AND ll.license_end > now() THEN true ELSE false END AS is_currently_active,

    fl.first_date,
    fl.first_username,
    fl.first_display_name,

    COALESCE(h.history_data, '[]'::jsonb),
    COALESCE(fs.is_fav, false),
    
    COALESCE(li.entry_count, 0)::bigint,
    COALESCE(li.has_entry, false),
    li.user_entry_id,
    ll.user_id
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE
  LEFT JOIN lottery_info li ON TRUE;
END;
$$;


ALTER FUNCTION "public"."get_fanmark_details_by_short_id"("shortid_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fanmark_ownership_status"("fanmark_license_id" "uuid") RETURNS TABLE("is_taken" boolean, "has_active_license" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 
    CASE WHEN fl.id IS NOT NULL THEN true ELSE false END as is_taken,
    CASE WHEN fl.status = 'active' AND fl.license_end > now() THEN true ELSE false END as has_active_license
  FROM public.fanmark_licenses fl
  WHERE fl.id = fanmark_license_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_fanmark_ownership_status"("fanmark_license_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_favorite_fanmarks"() RETURNS TABLE("favorite_id" "uuid", "discovery_id" "uuid", "favorited_at" timestamp with time zone, "fanmark_id" "uuid", "normalized_emoji_ids" "uuid"[], "emoji_ids" "uuid"[], "sequence_key" "uuid", "availability_status" "text", "search_count" bigint, "favorite_count" bigint, "short_id" "text", "fanmark_name" "text", "access_type" "text", "target_url" "text", "text_content" "text", "current_owner_username" "text", "current_owner_display_name" "text", "current_license_start" timestamp with time zone, "current_license_end" timestamp with time zone, "current_license_status" "text", "is_password_protected" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  auth_user_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    ff.id AS favorite_id,
    ff.discovery_id,
    ff.created_at AS favorited_at,
    d.fanmark_id,
    ff.normalized_emoji_ids,
    d.emoji_ids,
    seq_key(d.normalized_emoji_ids) AS sequence_key,
    d.availability_status,
    d.search_count,
    d.favorite_count,
    f.short_id,
    bc.fanmark_name,
    bc.access_type,
    rc.target_url,
    mc.content AS text_content,
    us.username AS current_owner_username,
    us.display_name AS current_owner_display_name,
    fl.license_start AS current_license_start,
    fl.license_end AS current_license_end,
    fl.status AS current_license_status,
    COALESCE(pc.is_enabled, false) AS is_password_protected
  FROM public.fanmark_favorites ff
  JOIN public.fanmark_discoveries d ON d.id = ff.discovery_id
  LEFT JOIN public.fanmarks f ON f.id = d.fanmark_id
  LEFT JOIN LATERAL (
    SELECT fl_inner.*
    FROM public.fanmark_licenses fl_inner
    WHERE fl_inner.fanmark_id = f.id
    ORDER BY fl_inner.license_end DESC NULLS LAST
    LIMIT 1
  ) fl ON true
  LEFT JOIN public.user_settings us ON us.user_id = fl.user_id
  LEFT JOIN public.fanmark_basic_configs bc ON bc.license_id = fl.id
  LEFT JOIN public.fanmark_redirect_configs rc ON rc.license_id = fl.id
  LEFT JOIN public.fanmark_messageboard_configs mc ON mc.license_id = fl.id
  LEFT JOIN public.fanmark_password_configs pc ON pc.license_id = fl.id
  WHERE ff.user_id = auth_user_id
  ORDER BY ff.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_favorite_fanmarks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_emoji_profile"("profile_license_id" "uuid") RETURNS TABLE("license_id" "uuid", "display_name" "text", "bio" "text", "social_links" "jsonb", "theme_settings" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT 
        fp.license_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.created_at,
        fp.updated_at
    FROM public.fanmark_profiles fp
    WHERE fp.license_id = profile_license_id
        AND fp.is_public = true
    ORDER BY fp.updated_at DESC
    LIMIT 1;
$$;


ALTER FUNCTION "public"."get_public_emoji_profile"("profile_license_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_fanmark_profile"("profile_fanmark_id" "uuid") RETURNS TABLE("id" "uuid", "fanmark_id" "uuid", "display_name" "text", "bio" "text", "social_links" "jsonb", "theme_settings" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fp.id,
    fp.fanmark_id,
    fp.display_name,
    fp.bio,
    fp.social_links,
    fp.theme_settings,
    fp.created_at,
    fp.updated_at
  FROM public.fanmark_profiles fp
  WHERE fp.fanmark_id = profile_fanmark_id 
    AND fp.is_public = true
  ORDER BY fp.updated_at DESC
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."get_public_fanmark_profile"("profile_fanmark_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_notification_count"("user_id_param" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_user_id uuid;
  unread_count integer;
BEGIN
  current_user_id := COALESCE(user_id_param, auth.uid());

  IF current_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer INTO unread_count
  FROM public.notifications
  WHERE user_id = current_user_id
    AND read_at IS NULL
    AND status = 'delivered'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN unread_count;
END;
$$;


ALTER FUNCTION "public"."get_unread_notification_count"("user_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_waitlist_email_by_id"("waitlist_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'UNAUTHORIZED_EMAIL_ACCESS',
      'waitlist',
      waitlist_id::text,
      jsonb_build_object(
        'timestamp', NOW(),
        'security_level', 'CRITICAL_RISK',
        'attempted_resource', 'email_address'
      )
    );
    
    RAISE EXCEPTION 'Unauthorized access to email data';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'EMAIL_ACCESS',
    'waitlist',
    waitlist_id::text,
    jsonb_build_object(
      'timestamp', NOW(),
      'security_level', 'ADMIN_VERIFIED',
      'purpose', 'email_retrieval'
    )
  );

  RETURN email_result;
END;
$$;


ALTER FUNCTION "public"."get_waitlist_email_by_id"("waitlist_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_waitlist_secure"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "email_hash" "text", "referral_source" "text", "status" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if not public.is_super_admin() then
    insert into public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) values (
      auth.uid(),
      'UNAUTHORIZED_WAITLIST_ACCESS',
      'waitlist',
      jsonb_build_object(
        'timestamp', now(),
        'ip_address', coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'),
        'attempted_action', 'get_waitlist_secure',
        'security_level', 'HIGH_RISK'
      )
    );
    raise exception 'Unauthorized access to waitlist data';
  end if;

  insert into public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) values (
    auth.uid(),
    'AUTHORIZED_WAITLIST_ACCESS',
    'waitlist',
    jsonb_build_object(
      'timestamp', now(),
      'record_count', (select count(*) from public.waitlist),
      'limit', p_limit,
      'offset', p_offset,
      'security_level', 'ADMIN_VERIFIED'
    )
  );

  return query
  select
    w.id,
    encode(digest(convert_to(w.email, 'UTF8'), 'sha256'), 'hex') as email_hash,
    w.referral_source,
    w.status,
    w.created_at
  from public.waitlist w
  order by w.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;


ALTER FUNCTION "public"."get_waitlist_secure"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_waitlist_secure"("p_limit" integer, "p_offset" integer) IS 'Return hashed waitlist data for admin use.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  generated_username TEXT;
BEGIN
  -- Generate username: user_ + first 8 chars of UUID
  generated_username := COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    'user_' || substring(NEW.id::text, 1, 8)
  );

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  )
  VALUES (
    NEW.id,
    generated_username,
    -- Use the same value as username for display_name (privacy protection)
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', generated_username),
    COALESCE((NEW.raw_user_meta_data ->> 'plan_type')::user_plan, 'free'),
    COALESCE((NEW.raw_user_meta_data ->> 'preferred_language')::user_language, 'ja'),
    NEW.raw_user_meta_data ->> 'invited_by_code',
    COALESCE((NEW.raw_user_meta_data ->> 'requires_password_setup')::boolean, false)
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_active_transfer"("license_uuid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fanmark_transfer_codes
    WHERE license_id = license_uuid
    AND status IN ('active', 'applied')
  );
$$;


ALTER FUNCTION "public"."has_active_transfer"("license_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_settings us
    where us.user_id = current_user_id
      and us.plan_type = 'admin'
  );
end;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin"() IS 'Returns TRUE when the current authenticated user has the admin plan';



CREATE OR REPLACE FUNCTION "public"."is_fanmark_licensed"("fanmark_license_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses 
    WHERE id = fanmark_license_id 
      AND status = 'active'
      AND license_end > now()
  );
$$;


ALTER FUNCTION "public"."is_fanmark_licensed"("fanmark_license_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_fanmark_password_protected"("fanmark_uuid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.fanmark_password_configs WHERE fanmark_id = fanmark_uuid),
    false
  );
$$;


ALTER FUNCTION "public"."is_fanmark_password_protected"("fanmark_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_id uuid;
  has_recent_session boolean := false;
  is_admin_user boolean := false;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return false;
  end if;

  select true
  into is_admin_user
  from public.user_settings us
  where us.user_id = current_user_id
    and us.plan_type = 'admin'
  limit 1;

  if not is_admin_user then
    return false;
  end if;

  -- Require a recent session within the last 4 hours (same behaviour as before)
  select exists(
    select 1
    from auth.sessions s
    where s.user_id = current_user_id
      and s.created_at > now() - interval '4 hours'
      and coalesce(s.aal, '') <> ''
  )
  into has_recent_session;

  insert into public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) values (
    current_user_id,
    'ADMIN_CHECK',
    'system',
    jsonb_build_object(
      'timestamp', now(),
      'session_valid', has_recent_session,
      'admin_check_result', has_recent_session
    )
  );

  return has_recent_session;
end;
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_super_admin"() IS 'Additional guard for critical operations. Requires admin plan and a recent valid session.';



CREATE OR REPLACE FUNCTION "public"."link_fanmark_discovery"("new_fanmark_id" "uuid", "normalized_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  linked_discovery_id uuid;
BEGIN
  IF new_fanmark_id IS NULL OR normalized_ids IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_discoveries
  SET fanmark_id = new_fanmark_id,
      availability_status = 'owned_by_user'
  WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
  RETURNING id INTO linked_discovery_id;

  IF linked_discovery_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_favorites
  SET fanmark_id = new_fanmark_id
  WHERE discovery_id = linked_discovery_id;
END;
$$;


ALTER FUNCTION "public"."link_fanmark_discovery"("new_fanmark_id" "uuid", "normalized_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_fanmark_discovery_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.link_fanmark_discovery(NEW.id, NEW.normalized_emoji_ids);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."link_fanmark_discovery_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_recent_fanmarks"("p_limit" integer DEFAULT 20) RETURNS TABLE("license_id" "uuid", "fanmark_id" "uuid", "fanmark_short_id" "text", "display_emoji" "text", "license_created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    raf.license_id,
    raf.fanmark_id,
    raf.fanmark_short_id,
    raf.display_emoji,
    raf.license_created_at
  FROM public.recent_active_fanmarks raf
  ORDER BY raf.license_created_at DESC
  LIMIT LEAST(50, GREATEST(1, COALESCE(p_limit, 20)));
$$;


ALTER FUNCTION "public"."list_recent_fanmarks"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_recent_fanmarks"("p_limit" integer) IS 'Returns up to 50 of the most recent active fanmark licenses with minimal public-safe data.';



CREATE OR REPLACE FUNCTION "public"."log_emoji_master_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_DELETE',
      'emoji_master',
      OLD.id::text,
      jsonb_build_object('emoji', OLD.emoji, 'short_name', OLD.short_name)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_UPDATE',
      'emoji_master',
      NEW.id::text,
      jsonb_build_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_INSERT',
      'emoji_master',
      NEW.id::text,
      jsonb_build_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_emoji_master_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_lottery_entry_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      'LOTTERY_ENTRY_CREATED',
      'fanmark_lottery_entry',
      NEW.id::text,
      jsonb_build_object(
        'fanmark_id', NEW.fanmark_id,
        'license_id', NEW.license_id,
        'lottery_probability', NEW.lottery_probability
      )
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.entry_status != NEW.entry_status THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      'LOTTERY_ENTRY_STATUS_CHANGED',
      'fanmark_lottery_entry',
      NEW.id::text,
      jsonb_build_object(
        'old_status', OLD.entry_status,
        'new_status', NEW.entry_status,
        'cancellation_reason', NEW.cancellation_reason
      )
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_lottery_entry_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_profile_cache_access"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only log if accessing multiple profiles (potential scraping behavior)
  -- This is a placeholder for more sophisticated monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'SELECT',
    'public_profile_cache',
    NEW.id::text,
    json_build_object(
      'accessed_at', now(),
      'user_agent', current_setting('request.headers', true)::json->>'user-agent'
    )
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_profile_cache_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_waitlist_access"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Log all SELECT operations on waitlist for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'SELECT',
    'waitlist',
    NEW.id::text,
    json_build_object(
      'table', 'waitlist',
      'access_time', now(),
      'user_role', (SELECT role FROM public.profiles WHERE user_id = auth.uid())
    )
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_waitlist_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_read"("user_id_param" "uuid", "read_via_param" "text" DEFAULT 'app'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_user_id uuid;
  updated_count integer;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow users to mark their own notifications as read
  IF current_user_id != user_id_param THEN
    RAISE EXCEPTION 'Unauthorized: can only mark own notifications as read';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE user_id = user_id_param
    AND read_at IS NULL
    AND status = 'delivered'
    AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN updated_count;
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_read"("user_id_param" "uuid", "read_via_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notification_read"("notification_id_param" "uuid", "read_via_param" "text" DEFAULT 'app'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE id = notification_id_param
    AND user_id = current_user_id
    AND read_at IS NULL;

  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."mark_notification_read"("notification_id_param" "uuid", "read_via_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_emoji_ids"("input_ids" "uuid"[]) RETURNS "uuid"[]
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  normalized_ids uuid[];
  id_count int;
  missing_count int;
  unresolved_count int;
BEGIN
  IF input_ids IS NULL OR array_length(input_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  id_count := array_length(input_ids, 1);

  WITH resolved AS (
    SELECT ids.ord, em.id AS master_id, em.codepoints
    FROM unnest(input_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  ),
  normalized AS (
    SELECT
      r.ord,
      r.master_id,
      CASE
        WHEN r.codepoints IS NULL THEN NULL
        ELSE ARRAY(
          SELECT cp_value
          FROM unnest(r.codepoints) WITH ORDINALITY cp(cp_value, idx)
          WHERE cp_value NOT IN ('1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF')
          ORDER BY idx
        )
      END AS normalized_codepoints
    FROM resolved r
  ),
  lookup AS (
    SELECT
      n.ord,
      n.master_id,
      n.normalized_codepoints,
      em_norm.id AS normalized_id
    FROM normalized n
    LEFT JOIN public.emoji_master em_norm
      ON em_norm.codepoints = n.normalized_codepoints
  )
  SELECT
    COUNT(*) FILTER (WHERE master_id IS NULL),
    COUNT(*) FILTER (WHERE normalized_id IS NULL),
    array_agg(normalized_id ORDER BY ord)
  INTO missing_count, unresolved_count, normalized_ids
  FROM lookup;

  IF missing_count > 0 OR unresolved_count > 0 THEN
    RETURN NULL;
  END IF;

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) <> id_count THEN
    RETURN NULL;
  END IF;

  RETURN normalized_ids;
END;
$$;


ALTER FUNCTION "public"."normalize_emoji_ids"("input_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_security_breach"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Log critical security events
  IF NEW.action = 'UNAUTHORIZED_WAITLIST_ACCESS' OR NEW.action = 'UNAUTHORIZED_EMAIL_ACCESS' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE 'SECURITY ALERT: Unauthorized access attempt by user % at %', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_security_breach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_fanmark_search"("input_emoji_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  discovery_id uuid;
  auth_user_id uuid;
BEGIN
  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, true);
  SELECT auth.uid() INTO auth_user_id;
  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('search', auth_user_id, discovery_id, public.normalize_emoji_ids(input_emoji_ids));
  RETURN discovery_id;
END;
$$;


ALTER FUNCTION "public"."record_fanmark_search"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_fanmark_favorite"("input_emoji_ids" "uuid"[]) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  deleted_record RECORD;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  DELETE FROM public.fanmark_favorites
  WHERE user_id = auth_user_id
    AND normalized_emoji_ids = normalized_ids
  RETURNING discovery_id INTO deleted_record;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = GREATEST(favorite_count - 1, 0)
  WHERE id = deleted_record.discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_remove', auth_user_id, deleted_record.discovery_id, normalized_ids);

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."remove_fanmark_favorite"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."render_notification_template"("template_id_param" "uuid", "template_version_param" integer, "payload_param" "jsonb", "language_param" "text" DEFAULT 'ja'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
  payload_value text;
  datetime_keys text[] := ARRAY['grace_expires_at', 'license_end', 'expires_at', 'created_at', 'updated_at'];
BEGIN
  SELECT title, body, summary
  INTO template_record
  FROM public.notification_templates
  WHERE template_id = template_id_param
    AND version = template_version_param
    AND language = language_param
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found: % version % language %',
      template_id_param, template_version_param, language_param;
  END IF;

  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    IF NOT (key_name = ANY(datetime_keys)) THEN
      payload_value := payload_param->>key_name;
      IF payload_value IS NOT NULL THEN
        rendered_title := REPLACE(rendered_title, '{{' || key_name || '}}', payload_value);
        rendered_body := REPLACE(rendered_body, '{{' || key_name || '}}', payload_value);
        IF rendered_summary IS NOT NULL THEN
          rendered_summary := REPLACE(rendered_summary, '{{' || key_name || '}}', payload_value);
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'title', rendered_title,
    'body', rendered_body,
    'summary', rendered_summary,
    'metadata', payload_param
  );
END;
$$;


ALTER FUNCTION "public"."render_notification_template"("template_id_param" "uuid", "template_version_param" integer, "payload_param" "jsonb", "language_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_fanmarks_with_lottery"("input_emoji_ids" "uuid"[]) RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
  lottery_entry_count bigint := 0;
  has_user_lottery_entry boolean := false;
  user_lottery_entry_id uuid := NULL;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_emoji_ids');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'tier_display_name', tier_info.display_name,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days,
        'lottery_entry_count', 0,
        'has_user_lottery_entry', false,
        'user_lottery_entry_id', NULL
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

  -- Get lottery information
  SELECT
    COUNT(*),
    BOOL_OR(fle.user_id = current_user_id),
    (SELECT fle2.id FROM fanmark_lottery_entries fle2 
     WHERE fle2.fanmark_id = fanmark_record.id 
       AND fle2.user_id = current_user_id 
       AND fle2.entry_status = 'pending' 
     LIMIT 1)
  INTO lottery_entry_count, has_user_lottery_entry, user_lottery_entry_id
  FROM fanmark_lottery_entries fle
  WHERE fle.fanmark_id = fanmark_record.id
    AND fle.entry_status = 'pending';

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = 'grace' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = 'grace' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = 'grace' THEN 'grace_period'
      ELSE 'taken'
    END;
  END IF;

  RETURN json_build_object(
    'available', is_available,
    'fanmark_id', fanmark_record.id,
    'reason', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    'available_at', available_at,
    'blocking_status', blocking_status,
    'lottery_entry_count', lottery_entry_count,
    'has_user_lottery_entry', has_user_lottery_entry,
    'user_lottery_entry_id', user_lottery_entry_id
  );
END;
$$;


ALTER FUNCTION "public"."search_fanmarks_with_lottery"("input_emoji_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seq_key"("normalized_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE STRICT
    AS $$
DECLARE
  hash text;
BEGIN
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'normalized_ids cannot be null or empty';
  END IF;

  hash := md5(array_to_string(normalized_ids, ','));

  RETURN (
    substr(hash, 1, 8) || '-' ||
    substr(hash, 9, 4) || '-' ||
    substr(hash, 13, 4) || '-' ||
    substr(hash, 17, 4) || '-' ||
    substr(hash, 21, 12)
  )::uuid;
END;
$$;


ALTER FUNCTION "public"."seq_key"("normalized_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_public_profile_cache"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_public_profile_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_fanmark_favorite"("fanmark_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_user_id uuid;
  is_favorited boolean;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;
  
  -- Check if already favorited
  SELECT EXISTS(
    SELECT 1 FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id
  ) INTO is_favorited;
  
  IF is_favorited THEN
    -- Remove favorite
    DELETE FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id;
    RETURN false;
  ELSE
    -- Add favorite
    INSERT INTO public.fanmark_favorites (fanmark_id, user_id) 
    VALUES (fanmark_uuid, current_user_id);
    RETURN true;
  END IF;
END;
$$;


ALTER FUNCTION "public"."toggle_fanmark_favorite"("fanmark_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_fanmark_discovery"("input_emoji_ids" "uuid"[], "increment_search" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  normalized_ids uuid[];
  discovery_id uuid;
  search_increment int := CASE WHEN increment_search THEN 1 ELSE 0 END;
BEGIN
  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  INSERT INTO public.fanmark_discoveries (
    emoji_ids,
    normalized_emoji_ids,
    last_seen_at,
    search_count
  )
  VALUES (
    input_emoji_ids,
    normalized_ids,
    now(),
    search_increment
  )
  ON CONFLICT (seq_key(normalized_emoji_ids))
  DO UPDATE SET
    emoji_ids = EXCLUDED.emoji_ids,
    last_seen_at = now(),
    search_count = public.fanmark_discoveries.search_count + search_increment
  RETURNING id INTO discovery_id;

  IF discovery_id IS NULL THEN
    SELECT id INTO discovery_id
    FROM public.fanmark_discoveries
    WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
    LIMIT 1;
  END IF;

  RETURN discovery_id;
END;
$$;


ALTER FUNCTION "public"."upsert_fanmark_discovery"("input_emoji_ids" "uuid"[], "increment_search" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_fanmark_password_config"("license_uuid" "uuid", "new_password" "text", "enable_password" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    config_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM public.fanmark_licenses fl
        WHERE fl.id = license_uuid 
          AND fl.user_id = auth.uid() 
          AND fl.status = 'active' 
          AND fl.license_end > now()
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
$$;


ALTER FUNCTION "public"."upsert_fanmark_password_config"("license_uuid" "uuid", "new_password" "text", "enable_password" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_invitation_code"("code_to_use" "text") RETURNS TABLE("success" boolean, "special_perks" "jsonb", "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '{}'::jsonb, 'Invalid or expired invitation code'::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''::text;
END;
$$;


ALTER FUNCTION "public"."use_invitation_code"("code_to_use" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_display_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Check if display_name looks like an email address
  IF NEW.display_name IS NOT NULL AND NEW.display_name LIKE '%@%.%' THEN
    -- Replace with safe display name
    NEW.display_name = public.generate_safe_display_name(NEW.display_name, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_display_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_invitation_code"("code_to_check" "text") RETURNS TABLE("is_valid" boolean, "special_perks" "jsonb", "remaining_uses" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, '{}'::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$$;


ALTER FUNCTION "public"."validate_invitation_code"("code_to_check" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_fanmark_password"("fanmark_uuid" "uuid", "provided_password" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  stored_password text;
  is_enabled boolean;
BEGIN
  -- Get the password configuration for the fanmark through license
  SELECT 
    pc.access_password,
    pc.is_enabled
  INTO stored_password, is_enabled
  FROM public.fanmarks f
  JOIN public.fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  JOIN public.fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.id = fanmark_uuid;
  
  -- Return false if no password config found or not enabled
  IF stored_password IS NULL OR is_enabled IS FALSE THEN
    RETURN false;
  END IF;
  
  -- Return true if passwords match
  RETURN stored_password = provided_password;
END;
$$;


ALTER FUNCTION "public"."verify_fanmark_password"("fanmark_uuid" "uuid", "provided_password" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "request_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."emoji_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "emoji" "text" NOT NULL,
    "short_name" "text" NOT NULL,
    "keywords" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "category" "text",
    "subcategory" "text",
    "codepoints" "text"[] NOT NULL,
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."emoji_master" OWNER TO "postgres";


COMMENT ON TABLE "public"."emoji_master" IS 'Canonical emoji master data used for normalization and lookup.';



CREATE TABLE IF NOT EXISTS "public"."enterprise_user_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "custom_fanmarks_limit" integer,
    "custom_pricing" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."enterprise_user_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extension_coupon_usages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coupon_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "license_id" "uuid" NOT NULL,
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."extension_coupon_usages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extension_coupons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "months" smallint NOT NULL,
    "allowed_tier_levels" smallint[],
    "max_uses" integer DEFAULT 1 NOT NULL,
    "used_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "extension_coupons_months_check" CHECK (("months" = ANY (ARRAY[1, 2, 3, 6])))
);


ALTER TABLE "public"."extension_coupons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_access_daily_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "license_id" "uuid",
    "stat_date" "date" NOT NULL,
    "access_count" integer DEFAULT 0,
    "unique_visitors" integer DEFAULT 0,
    "referrer_direct" integer DEFAULT 0,
    "referrer_search" integer DEFAULT 0,
    "referrer_social" integer DEFAULT 0,
    "referrer_other" integer DEFAULT 0,
    "device_mobile" integer DEFAULT 0,
    "device_tablet" integer DEFAULT 0,
    "device_desktop" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "access_type_profile" integer DEFAULT 0,
    "access_type_redirect" integer DEFAULT 0,
    "access_type_text" integer DEFAULT 0,
    "access_type_inactive" integer DEFAULT 0
);


ALTER TABLE "public"."fanmark_access_daily_stats" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fanmark_access_daily_stats"."access_type_profile" IS 'Daily count of profile access type';



COMMENT ON COLUMN "public"."fanmark_access_daily_stats"."access_type_redirect" IS 'Daily count of redirect access type';



COMMENT ON COLUMN "public"."fanmark_access_daily_stats"."access_type_text" IS 'Daily count of text (messageboard) access type';



COMMENT ON COLUMN "public"."fanmark_access_daily_stats"."access_type_inactive" IS 'Daily count of inactive access type';



CREATE TABLE IF NOT EXISTS "public"."fanmark_access_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "license_id" "uuid",
    "accessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "referrer" "text",
    "referrer_domain" "text",
    "referrer_category" "text",
    "user_agent" "text",
    "device_type" "text",
    "browser" "text",
    "os" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "visitor_hash" "text",
    "access_type" "text"
);


ALTER TABLE "public"."fanmark_access_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fanmark_access_logs"."access_type" IS 'Access type at the time of access: profile, redirect, text, inactive';



CREATE TABLE IF NOT EXISTS "public"."fanmark_availability_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_type" "text" NOT NULL,
    "priority" integer NOT NULL,
    "rule_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "price_usd" numeric(10,2),
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "fanmark_availability_rules_priority_check" CHECK ((("priority" >= 1) AND ("priority" <= 4))),
    CONSTRAINT "fanmark_availability_rules_rule_type_check" CHECK (("rule_type" = ANY (ARRAY['specific_pattern'::"text", 'duplicate_pattern'::"text", 'prefix_pattern'::"text", 'count_based'::"text"])))
);


ALTER TABLE "public"."fanmark_availability_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_basic_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "license_id" "uuid" NOT NULL,
    "fanmark_name" "text",
    "access_type" "text" DEFAULT 'inactive'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_basic_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_discoveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "emoji_ids" "uuid"[] NOT NULL,
    "normalized_emoji_ids" "uuid"[] NOT NULL,
    "fanmark_id" "uuid",
    "availability_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_count" bigint DEFAULT 0 NOT NULL,
    "favorite_count" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "fanmark_discoveries_availability_check" CHECK (("availability_status" = ANY (ARRAY['unknown'::"text", 'unclaimed'::"text", 'claimed_external'::"text", 'owned_by_user'::"text"])))
);


ALTER TABLE "public"."fanmark_discoveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_events" (
    "id" bigint NOT NULL,
    "event_type" "text" NOT NULL,
    "user_id" "uuid",
    "discovery_id" "uuid",
    "normalized_emoji_ids" "uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."fanmark_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."fanmark_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."fanmark_events_id_seq" OWNED BY "public"."fanmark_events"."id";



CREATE TABLE IF NOT EXISTS "public"."fanmark_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "discovery_id" "uuid" NOT NULL,
    "fanmark_id" "uuid",
    "normalized_emoji_ids" "uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_licenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "license_start" timestamp with time zone DEFAULT "now"() NOT NULL,
    "license_end" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_initial_license" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan_excluded" boolean DEFAULT false,
    "excluded_at" timestamp with time zone,
    "excluded_from_plan" "text",
    "grace_expires_at" timestamp with time zone,
    "is_returned" boolean DEFAULT false NOT NULL,
    "is_transferred" boolean DEFAULT false NOT NULL,
    "transfer_locked_until" timestamp with time zone,
    CONSTRAINT "fanmark_licenses_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'grace'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."fanmark_licenses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."fanmark_licenses"."user_id" IS 'User who owns/owned this license. NULL indicates the user account has been deleted but license history is retained for audit purposes.';



CREATE TABLE IF NOT EXISTS "public"."fanmark_lottery_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "license_id" "uuid" NOT NULL,
    "lottery_probability" numeric DEFAULT 1.0 NOT NULL,
    "entry_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lottery_executed_at" timestamp with time zone,
    "won_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "positive_probability" CHECK (("lottery_probability" > (0)::numeric)),
    CONSTRAINT "valid_cancellation_reason" CHECK ((("cancellation_reason" IS NULL) OR ("cancellation_reason" = ANY (ARRAY['user_request'::"text", 'license_extended'::"text", 'system'::"text"])))),
    CONSTRAINT "valid_entry_status" CHECK (("entry_status" = ANY (ARRAY['pending'::"text", 'won'::"text", 'lost'::"text", 'cancelled'::"text", 'cancelled_by_extension'::"text"])))
);


ALTER TABLE "public"."fanmark_lottery_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_lottery_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "license_id" "uuid" NOT NULL,
    "total_entries" integer NOT NULL,
    "winner_user_id" "uuid",
    "winner_entry_id" "uuid",
    "probability_distribution" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "random_seed" "text",
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "execution_method" "text" DEFAULT 'automatic'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_execution_method" CHECK (("execution_method" = ANY (ARRAY['automatic'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."fanmark_lottery_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_messageboard_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "license_id" "uuid" NOT NULL,
    "content" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_messageboard_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_password_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "license_id" "uuid" NOT NULL,
    "access_password" "text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_password_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "license_id" "uuid" NOT NULL,
    "display_name" "text",
    "bio" "text",
    "social_links" "jsonb" DEFAULT '{}'::"jsonb",
    "theme_settings" "jsonb" DEFAULT '{}'::"jsonb",
    "is_public" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_redirect_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "license_id" "uuid" NOT NULL,
    "target_url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fanmark_redirect_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_tier_extension_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier_level" smallint NOT NULL,
    "months" smallint NOT NULL,
    "price_yen" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_price_id" "text",
    CONSTRAINT "fanmark_tier_extension_prices_months_check" CHECK (("months" >= 1)),
    CONSTRAINT "fanmark_tier_extension_prices_price_check" CHECK (("price_yen" >= 0)),
    CONSTRAINT "fanmark_tier_extension_prices_tier_check" CHECK (("tier_level" >= 1))
);


ALTER TABLE "public"."fanmark_tier_extension_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier_level" integer NOT NULL,
    "emoji_count_min" integer NOT NULL,
    "emoji_count_max" integer NOT NULL,
    "monthly_price_usd" numeric(10,2) DEFAULT 0 NOT NULL,
    "initial_license_days" integer,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text" NOT NULL
);


ALTER TABLE "public"."fanmark_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_transfer_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "license_id" "uuid" NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "issuer_user_id" "uuid" NOT NULL,
    "transfer_code" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "disclaimer_agreed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_transfer_code_status" CHECK (("status" = ANY (ARRAY['active'::"text", 'applied'::"text", 'completed'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."fanmark_transfer_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmark_transfer_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transfer_code_id" "uuid" NOT NULL,
    "license_id" "uuid" NOT NULL,
    "fanmark_id" "uuid" NOT NULL,
    "requester_user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "disclaimer_agreed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requester_username" "text",
    "requester_display_name" "text",
    CONSTRAINT "valid_transfer_request_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."fanmark_transfer_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fanmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_input_fanmark" "text" NOT NULL,
    "normalized_emoji" "text" NOT NULL,
    "short_id" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "emoji_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "normalized_emoji_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "tier_level" smallint NOT NULL,
    CONSTRAINT "fanmarks_short_id_length" CHECK (("char_length"("short_id") >= 6)),
    CONSTRAINT "fanmarks_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"]))),
    CONSTRAINT "fanmarks_status_valid" CHECK (("status" = ANY (ARRAY['active'::"text", 'reserved'::"text", 'banned'::"text"]))),
    CONSTRAINT "fanmarks_tier_level_check" CHECK (("tier_level" >= 1))
);


ALTER TABLE "public"."fanmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitation_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "max_uses" integer DEFAULT 1 NOT NULL,
    "used_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "special_perks" "jsonb" DEFAULT '{}'::"jsonb",
    "created_by" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invitation_codes_code_format" CHECK (("code" ~ '^[A-Z0-9]{6,12}$'::"text")),
    CONSTRAINT "invitation_codes_max_uses_positive" CHECK (("max_uses" > 0)),
    CONSTRAINT "invitation_codes_used_count_valid" CHECK ((("used_count" >= 0) AND ("used_count" <= "max_uses")))
);


ALTER TABLE "public"."invitation_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "event_version" integer DEFAULT 1 NOT NULL,
    "source" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "payload_schema" "text",
    "trigger_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedupe_key" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "processed_at" timestamp with time zone,
    "error_reason" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_events_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'cron_job'::"text", 'edge_function'::"text", 'admin_ui'::"text", 'admin_manual'::"text", 'batch'::"text"]))),
    CONSTRAINT "notification_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'processed'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."notification_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_events" IS 'Stores notification trigger events with deduplication';



CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "event_type" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_preferences_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'webpush'::"text"])))
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_preferences" IS 'User notification preferences (future expansion)';



CREATE TABLE IF NOT EXISTS "public"."notification_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "template_version" integer DEFAULT 1 NOT NULL,
    "delay_seconds" integer DEFAULT 0 NOT NULL,
    "priority" integer DEFAULT 5 NOT NULL,
    "segment_filter" "jsonb",
    "cooldown_window_seconds" integer,
    "max_per_user" integer,
    "cancel_condition" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "valid_from" timestamp with time zone,
    "valid_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "notification_rules_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'webpush'::"text"]))),
    CONSTRAINT "notification_rules_priority_check" CHECK ((("priority" >= 1) AND ("priority" <= 10)))
);


ALTER TABLE "public"."notification_rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_rules" IS 'Defines notification delivery rules per event type';



CREATE TABLE IF NOT EXISTS "public"."notification_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "channel" "text" NOT NULL,
    "language" "text" DEFAULT 'ja'::"text" NOT NULL,
    "title" "text",
    "body" "text" NOT NULL,
    "summary" "text",
    "payload_schema" "jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_templates_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'webpush'::"text"])))
);


ALTER TABLE "public"."notification_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_templates" IS 'Notification message templates with versioning';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "rule_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "template_version" integer DEFAULT 1 NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 5 NOT NULL,
    "triggered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "error_reason" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "read_at" timestamp with time zone,
    "read_via" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'webpush'::"text"]))),
    CONSTRAINT "notifications_priority_check" CHECK ((("priority" >= 1) AND ("priority" <= 10))),
    CONSTRAINT "notifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'delivered'::"text", 'failed'::"text", 'cancelled'::"text", 'sending'::"text", 'sent'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'Actual notification records delivered to users';



CREATE TABLE IF NOT EXISTS "public"."notifications_history" (
    "id" "uuid" NOT NULL,
    "original_data" "jsonb" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications_history" IS 'Archived notifications for compliance';



CREATE OR REPLACE VIEW "public"."recent_active_fanmarks" WITH ("security_invoker"='true') AS
 SELECT "fl"."id" AS "license_id",
    "fl"."fanmark_id",
    "f"."short_id" AS "fanmark_short_id",
    COALESCE("f"."normalized_emoji", "f"."user_input_fanmark") AS "display_emoji",
    "fl"."created_at" AS "license_created_at"
   FROM ("public"."fanmark_licenses" "fl"
     JOIN "public"."fanmarks" "f" ON (("f"."id" = "fl"."fanmark_id")))
  WHERE ("fl"."status" = 'active'::"text");


ALTER VIEW "public"."recent_active_fanmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reserved_emoji_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pattern" "text" NOT NULL,
    "price_yen" integer NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reserved_emoji_patterns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "text" NOT NULL,
    "description" "text",
    "is_public" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "system_settings_key_format" CHECK (("setting_key" ~ '^[a-z_]+$'::"text"))
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "plan_type" "public"."user_plan" DEFAULT 'free'::"public"."user_plan" NOT NULL,
    "preferred_language" "public"."user_language" DEFAULT 'ja'::"public"."user_language" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invited_by_code" "text",
    "requires_password_setup" boolean DEFAULT false NOT NULL,
    "stripe_customer_id" "text"
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_settings"."preferred_language" IS 'User preferred language. Defaults to Japanese (ja) for new users.';



COMMENT ON COLUMN "public"."user_settings"."invited_by_code" IS 'Invitation code used during signup';



COMMENT ON COLUMN "public"."user_settings"."requires_password_setup" IS 'Indicates that the user must complete password setup before accessing the app';



CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "stripe_subscription_id" "text" NOT NULL,
    "product_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "price_id" "text",
    "amount" integer,
    "currency" "text",
    "interval" "text",
    "interval_count" integer
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_subscriptions"."price_id" IS 'Stripe Price ID associated with the active subscription';



CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "referral_source" "text",
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "waitlist_email_format" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text")),
    CONSTRAINT "waitlist_status_valid" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'invited'::"text", 'converted'::"text"])))
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."fanmark_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."fanmark_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."emoji_master"
    ADD CONSTRAINT "emoji_master_emoji_key" UNIQUE ("emoji");



ALTER TABLE ONLY "public"."emoji_master"
    ADD CONSTRAINT "emoji_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enterprise_user_settings"
    ADD CONSTRAINT "enterprise_user_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enterprise_user_settings"
    ADD CONSTRAINT "enterprise_user_settings_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."extension_coupon_usages"
    ADD CONSTRAINT "extension_coupon_usages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_coupons"
    ADD CONSTRAINT "extension_coupons_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."extension_coupons"
    ADD CONSTRAINT "extension_coupons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_access_daily_stats"
    ADD CONSTRAINT "fanmark_access_daily_stats_fanmark_id_stat_date_key" UNIQUE ("fanmark_id", "stat_date");



ALTER TABLE ONLY "public"."fanmark_access_daily_stats"
    ADD CONSTRAINT "fanmark_access_daily_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_access_logs"
    ADD CONSTRAINT "fanmark_access_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_availability_rules"
    ADD CONSTRAINT "fanmark_availability_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_basic_configs"
    ADD CONSTRAINT "fanmark_basic_configs_license_id_key" UNIQUE ("license_id");



ALTER TABLE ONLY "public"."fanmark_basic_configs"
    ADD CONSTRAINT "fanmark_basic_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_discoveries"
    ADD CONSTRAINT "fanmark_discoveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_events"
    ADD CONSTRAINT "fanmark_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_favorites"
    ADD CONSTRAINT "fanmark_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_licenses"
    ADD CONSTRAINT "fanmark_licenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_lottery_entries"
    ADD CONSTRAINT "fanmark_lottery_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_lottery_history"
    ADD CONSTRAINT "fanmark_lottery_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_messageboard_configs"
    ADD CONSTRAINT "fanmark_messageboard_configs_license_id_key" UNIQUE ("license_id");



ALTER TABLE ONLY "public"."fanmark_messageboard_configs"
    ADD CONSTRAINT "fanmark_messageboard_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_password_configs"
    ADD CONSTRAINT "fanmark_password_configs_license_id_key" UNIQUE ("license_id");



ALTER TABLE ONLY "public"."fanmark_password_configs"
    ADD CONSTRAINT "fanmark_password_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_profiles"
    ADD CONSTRAINT "fanmark_profiles_license_id_key" UNIQUE ("license_id");



ALTER TABLE ONLY "public"."fanmark_profiles"
    ADD CONSTRAINT "fanmark_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_redirect_configs"
    ADD CONSTRAINT "fanmark_redirect_configs_license_id_key" UNIQUE ("license_id");



ALTER TABLE ONLY "public"."fanmark_redirect_configs"
    ADD CONSTRAINT "fanmark_redirect_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_tier_extension_prices"
    ADD CONSTRAINT "fanmark_tier_extension_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_tier_extension_prices"
    ADD CONSTRAINT "fanmark_tier_extension_prices_unique" UNIQUE ("tier_level", "months");



ALTER TABLE ONLY "public"."fanmark_tiers"
    ADD CONSTRAINT "fanmark_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_tiers"
    ADD CONSTRAINT "fanmark_tiers_tier_level_key" UNIQUE ("tier_level");



ALTER TABLE ONLY "public"."fanmark_transfer_codes"
    ADD CONSTRAINT "fanmark_transfer_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmark_transfer_codes"
    ADD CONSTRAINT "fanmark_transfer_codes_transfer_code_key" UNIQUE ("transfer_code");



ALTER TABLE ONLY "public"."fanmark_transfer_requests"
    ADD CONSTRAINT "fanmark_transfer_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmarks"
    ADD CONSTRAINT "fanmarks_normalized_emoji_ids_unique" UNIQUE ("normalized_emoji_ids");



ALTER TABLE ONLY "public"."fanmarks"
    ADD CONSTRAINT "fanmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fanmarks"
    ADD CONSTRAINT "fanmarks_short_id_key" UNIQUE ("short_id");



ALTER TABLE ONLY "public"."fanmarks"
    ADD CONSTRAINT "fanmarks_user_input_fanmark_unique" UNIQUE ("normalized_emoji");



ALTER TABLE ONLY "public"."invitation_codes"
    ADD CONSTRAINT "invitation_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."invitation_codes"
    ADD CONSTRAINT "invitation_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_rules"
    ADD CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_templates"
    ADD CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications_history"
    ADD CONSTRAINT "notifications_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reserved_emoji_patterns"
    ADD CONSTRAINT "reserved_emoji_patterns_pattern_key" UNIQUE ("pattern");



ALTER TABLE ONLY "public"."reserved_emoji_patterns"
    ADD CONSTRAINT "reserved_emoji_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "unique_event_dedupe" UNIQUE ("event_type", "dedupe_key");



ALTER TABLE ONLY "public"."fanmark_lottery_entries"
    ADD CONSTRAINT "unique_fanmark_user_license" UNIQUE ("fanmark_id", "user_id", "license_id");



ALTER TABLE ONLY "public"."notification_templates"
    ADD CONSTRAINT "unique_template_version" UNIQUE ("template_id", "version", "channel", "language");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "unique_user_channel_event" UNIQUE ("user_id", "channel", "event_type");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_stripe_subscription_id_key" UNIQUE ("user_id", "stripe_subscription_id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "fanmark_discoveries_fanmark_idx" ON "public"."fanmark_discoveries" USING "btree" ("fanmark_id");



CREATE INDEX "fanmark_discoveries_last_seen_idx" ON "public"."fanmark_discoveries" USING "btree" ("last_seen_at" DESC);



CREATE UNIQUE INDEX "fanmark_discoveries_seq_key_idx" ON "public"."fanmark_discoveries" USING "btree" ("public"."seq_key"("normalized_emoji_ids"));



CREATE INDEX "fanmark_events_type_created_idx" ON "public"."fanmark_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "fanmark_favorites_fanmark_idx" ON "public"."fanmark_favorites" USING "btree" ("fanmark_id");



CREATE INDEX "fanmark_favorites_user_idx" ON "public"."fanmark_favorites" USING "btree" ("user_id");



CREATE UNIQUE INDEX "fanmark_favorites_user_seq_idx" ON "public"."fanmark_favorites" USING "btree" ("user_id", "public"."seq_key"("normalized_emoji_ids"));



CREATE UNIQUE INDEX "fanmarks_seq_key_idx" ON "public"."fanmarks" USING "btree" ("public"."seq_key"("normalized_emoji_ids"));



CREATE INDEX "idx_access_logs_access_type" ON "public"."fanmark_access_logs" USING "btree" ("access_type");



CREATE INDEX "idx_access_logs_accessed_at" ON "public"."fanmark_access_logs" USING "btree" ("accessed_at");



CREATE INDEX "idx_access_logs_fanmark_date" ON "public"."fanmark_access_logs" USING "btree" ("fanmark_id", "accessed_at");



CREATE INDEX "idx_access_logs_fanmark_id" ON "public"."fanmark_access_logs" USING "btree" ("fanmark_id");



CREATE INDEX "idx_access_logs_visitor_hash" ON "public"."fanmark_access_logs" USING "btree" ("visitor_hash", "accessed_at");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_daily_stats_fanmark_date" ON "public"."fanmark_access_daily_stats" USING "btree" ("fanmark_id", "stat_date");



CREATE INDEX "idx_daily_stats_fanmark_date_type" ON "public"."fanmark_access_daily_stats" USING "btree" ("fanmark_id", "stat_date", "access_type_profile", "access_type_redirect", "access_type_text", "access_type_inactive");



CREATE INDEX "idx_emoji_master_category" ON "public"."emoji_master" USING "btree" ("category", "subcategory");



CREATE INDEX "idx_emoji_master_keywords" ON "public"."emoji_master" USING "gin" ("keywords");



CREATE INDEX "idx_emoji_master_short_name" ON "public"."emoji_master" USING "gin" ("to_tsvector"('"simple"'::"regconfig", "short_name"));



CREATE INDEX "idx_extension_coupon_usages_coupon_id" ON "public"."extension_coupon_usages" USING "btree" ("coupon_id");



CREATE INDEX "idx_extension_coupon_usages_user_id" ON "public"."extension_coupon_usages" USING "btree" ("user_id");



CREATE INDEX "idx_extension_coupons_active" ON "public"."extension_coupons" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_extension_coupons_code" ON "public"."extension_coupons" USING "btree" ("code");



CREATE INDEX "idx_fanmark_availability_rules_available" ON "public"."fanmark_availability_rules" USING "btree" ("is_available") WHERE ("is_available" = true);



CREATE INDEX "idx_fanmark_availability_rules_type_priority" ON "public"."fanmark_availability_rules" USING "btree" ("rule_type", "priority");



CREATE INDEX "idx_fanmark_licenses_fanmark_grace" ON "public"."fanmark_licenses" USING "btree" ("fanmark_id", "status", "grace_expires_at") WHERE ("status" = ANY (ARRAY['active'::"text", 'grace'::"text"]));



CREATE INDEX "idx_fanmark_licenses_fanmark_id" ON "public"."fanmark_licenses" USING "btree" ("fanmark_id");



CREATE INDEX "idx_fanmark_licenses_grace_expires" ON "public"."fanmark_licenses" USING "btree" ("grace_expires_at") WHERE ("status" = 'grace'::"text");



CREATE INDEX "idx_fanmark_licenses_license_end" ON "public"."fanmark_licenses" USING "btree" ("license_end");



CREATE INDEX "idx_fanmark_licenses_status" ON "public"."fanmark_licenses" USING "btree" ("status");



CREATE INDEX "idx_fanmark_licenses_user_id" ON "public"."fanmark_licenses" USING "btree" ("user_id");



CREATE INDEX "idx_fanmarks_emoji_ids" ON "public"."fanmarks" USING "gin" ("emoji_ids");



CREATE INDEX "idx_fanmarks_normalized_emoji" ON "public"."fanmarks" USING "btree" ("normalized_emoji");



CREATE INDEX "idx_fanmarks_normalized_emoji_ids" ON "public"."fanmarks" USING "gin" ("normalized_emoji_ids");



CREATE INDEX "idx_fanmarks_status" ON "public"."fanmarks" USING "btree" ("status");



CREATE INDEX "idx_invitation_codes_active" ON "public"."invitation_codes" USING "btree" ("is_active", "expires_at");



CREATE INDEX "idx_invitation_codes_code" ON "public"."invitation_codes" USING "btree" ("code");



CREATE INDEX "idx_lottery_entries_fanmark_status" ON "public"."fanmark_lottery_entries" USING "btree" ("fanmark_id", "entry_status");



CREATE INDEX "idx_lottery_entries_license_status" ON "public"."fanmark_lottery_entries" USING "btree" ("license_id", "entry_status");



CREATE INDEX "idx_lottery_entries_user_status" ON "public"."fanmark_lottery_entries" USING "btree" ("user_id", "entry_status");



CREATE INDEX "idx_lottery_history_executed_at" ON "public"."fanmark_lottery_history" USING "btree" ("executed_at" DESC);



CREATE INDEX "idx_lottery_history_fanmark" ON "public"."fanmark_lottery_history" USING "btree" ("fanmark_id");



CREATE INDEX "idx_notification_events_event_type" ON "public"."notification_events" USING "btree" ("event_type");



CREATE INDEX "idx_notification_events_status_trigger" ON "public"."notification_events" USING "btree" ("status", "trigger_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_notification_rules_event_type" ON "public"."notification_rules" USING "btree" ("event_type") WHERE ("enabled" = true);



CREATE INDEX "idx_notifications_status_channel" ON "public"."notifications" USING "btree" ("status", "channel") WHERE ("status" = ANY (ARRAY['pending'::"text", 'failed'::"text"]));



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "read_at") WHERE (("read_at" IS NULL) AND ("channel" = 'in_app'::"text"));



CREATE INDEX "idx_reserved_emoji_patterns_pattern" ON "public"."reserved_emoji_patterns" USING "btree" ("pattern");



CREATE INDEX "idx_system_settings_key" ON "public"."system_settings" USING "btree" ("setting_key");



CREATE INDEX "idx_transfer_codes_fanmark_id" ON "public"."fanmark_transfer_codes" USING "btree" ("fanmark_id");



CREATE INDEX "idx_transfer_codes_issuer_user_id" ON "public"."fanmark_transfer_codes" USING "btree" ("issuer_user_id");



CREATE INDEX "idx_transfer_codes_license_id" ON "public"."fanmark_transfer_codes" USING "btree" ("license_id");



CREATE INDEX "idx_transfer_codes_status" ON "public"."fanmark_transfer_codes" USING "btree" ("status");



CREATE INDEX "idx_transfer_codes_transfer_code" ON "public"."fanmark_transfer_codes" USING "btree" ("transfer_code");



CREATE INDEX "idx_transfer_requests_fanmark_id" ON "public"."fanmark_transfer_requests" USING "btree" ("fanmark_id");



CREATE INDEX "idx_transfer_requests_license_id" ON "public"."fanmark_transfer_requests" USING "btree" ("license_id");



CREATE INDEX "idx_transfer_requests_requester_user_id" ON "public"."fanmark_transfer_requests" USING "btree" ("requester_user_id");



CREATE INDEX "idx_transfer_requests_status" ON "public"."fanmark_transfer_requests" USING "btree" ("status");



CREATE INDEX "idx_transfer_requests_transfer_code_id" ON "public"."fanmark_transfer_requests" USING "btree" ("transfer_code_id");



CREATE INDEX "idx_user_settings_invited_by_code" ON "public"."user_settings" USING "btree" ("invited_by_code") WHERE ("invited_by_code" IS NOT NULL);



CREATE INDEX "idx_user_subscriptions_status" ON "public"."user_subscriptions" USING "btree" ("status");



CREATE INDEX "idx_user_subscriptions_stripe_customer_id" ON "public"."user_subscriptions" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_user_subscriptions_user_id" ON "public"."user_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_waitlist_email" ON "public"."waitlist" USING "btree" ("email");



CREATE UNIQUE INDEX "user_settings_stripe_customer_id_key" ON "public"."user_settings" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "audit_emoji_master_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."emoji_master" FOR EACH ROW EXECUTE FUNCTION "public"."log_emoji_master_changes"();



CREATE OR REPLACE TRIGGER "audit_lottery_entry_changes" AFTER INSERT OR UPDATE ON "public"."fanmark_lottery_entries" FOR EACH ROW EXECUTE FUNCTION "public"."log_lottery_entry_changes"();



CREATE OR REPLACE TRIGGER "security_alert_trigger" AFTER INSERT ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."notify_security_breach"();



CREATE OR REPLACE TRIGGER "trg_link_fanmark_discovery" AFTER INSERT ON "public"."fanmarks" FOR EACH ROW EXECUTE FUNCTION "public"."link_fanmark_discovery_trigger"();



CREATE OR REPLACE TRIGGER "update_emoji_master_updated_at" BEFORE UPDATE ON "public"."emoji_master" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_enterprise_user_settings_updated_at" BEFORE UPDATE ON "public"."enterprise_user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extension_coupons_updated_at" BEFORE UPDATE ON "public"."extension_coupons" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_availability_rules_updated_at" BEFORE UPDATE ON "public"."fanmark_availability_rules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_basic_configs_updated_at" BEFORE UPDATE ON "public"."fanmark_basic_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_licenses_updated_at" BEFORE UPDATE ON "public"."fanmark_licenses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_messageboard_configs_updated_at" BEFORE UPDATE ON "public"."fanmark_messageboard_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_password_configs_updated_at" BEFORE UPDATE ON "public"."fanmark_password_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_profiles_updated_at" BEFORE UPDATE ON "public"."fanmark_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_redirect_configs_updated_at" BEFORE UPDATE ON "public"."fanmark_redirect_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_tier_extension_prices_updated_at" BEFORE UPDATE ON "public"."fanmark_tier_extension_prices" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_tiers_updated_at" BEFORE UPDATE ON "public"."fanmark_tiers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_transfer_codes_updated_at" BEFORE UPDATE ON "public"."fanmark_transfer_codes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmark_transfer_requests_updated_at" BEFORE UPDATE ON "public"."fanmark_transfer_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fanmarks_updated_at" BEFORE UPDATE ON "public"."fanmarks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_invitation_codes_updated_at" BEFORE UPDATE ON "public"."invitation_codes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_lottery_entries_updated_at" BEFORE UPDATE ON "public"."fanmark_lottery_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_notification_events_updated_at" BEFORE UPDATE ON "public"."notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_notification_preferences_updated_at" BEFORE UPDATE ON "public"."notification_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_notification_rules_updated_at" BEFORE UPDATE ON "public"."notification_rules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_notification_templates_updated_at" BEFORE UPDATE ON "public"."notification_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_notifications_updated_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_reserved_emoji_patterns_updated_at" BEFORE UPDATE ON "public"."reserved_emoji_patterns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_system_settings_updated_at" BEFORE UPDATE ON "public"."system_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_settings_updated_at" BEFORE UPDATE ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_subscriptions_updated_at" BEFORE UPDATE ON "public"."user_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."extension_coupon_usages"
    ADD CONSTRAINT "extension_coupon_usages_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."extension_coupons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_coupon_usages"
    ADD CONSTRAINT "extension_coupon_usages_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id");



ALTER TABLE ONLY "public"."extension_coupon_usages"
    ADD CONSTRAINT "extension_coupon_usages_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id");



ALTER TABLE ONLY "public"."fanmark_access_daily_stats"
    ADD CONSTRAINT "fanmark_access_daily_stats_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_access_daily_stats"
    ADD CONSTRAINT "fanmark_access_daily_stats_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fanmark_access_logs"
    ADD CONSTRAINT "fanmark_access_logs_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_access_logs"
    ADD CONSTRAINT "fanmark_access_logs_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fanmark_availability_rules"
    ADD CONSTRAINT "fanmark_availability_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



COMMENT ON CONSTRAINT "fanmark_availability_rules_created_by_fkey" ON "public"."fanmark_availability_rules" IS 'Set created_by to NULL when user is deleted';



ALTER TABLE ONLY "public"."fanmark_basic_configs"
    ADD CONSTRAINT "fanmark_basic_configs_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_discoveries"
    ADD CONSTRAINT "fanmark_discoveries_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fanmark_events"
    ADD CONSTRAINT "fanmark_events_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "public"."fanmark_discoveries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fanmark_favorites"
    ADD CONSTRAINT "fanmark_favorites_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "public"."fanmark_discoveries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_favorites"
    ADD CONSTRAINT "fanmark_favorites_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fanmark_favorites"
    ADD CONSTRAINT "fanmark_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_licenses"
    ADD CONSTRAINT "fanmark_licenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



COMMENT ON CONSTRAINT "fanmark_licenses_user_id_fkey" ON "public"."fanmark_licenses" IS 'Ensures user_id references valid auth users. Sets to NULL on user deletion to preserve license history.';



ALTER TABLE ONLY "public"."fanmark_lottery_entries"
    ADD CONSTRAINT "fanmark_lottery_entries_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_lottery_entries"
    ADD CONSTRAINT "fanmark_lottery_entries_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_lottery_history"
    ADD CONSTRAINT "fanmark_lottery_history_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_lottery_history"
    ADD CONSTRAINT "fanmark_lottery_history_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_lottery_history"
    ADD CONSTRAINT "fanmark_lottery_history_winner_entry_id_fkey" FOREIGN KEY ("winner_entry_id") REFERENCES "public"."fanmark_lottery_entries"("id");



ALTER TABLE ONLY "public"."fanmark_messageboard_configs"
    ADD CONSTRAINT "fanmark_messageboard_configs_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_password_configs"
    ADD CONSTRAINT "fanmark_password_configs_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_profiles"
    ADD CONSTRAINT "fanmark_profiles_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_redirect_configs"
    ADD CONSTRAINT "fanmark_redirect_configs_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_transfer_codes"
    ADD CONSTRAINT "fanmark_transfer_codes_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_transfer_codes"
    ADD CONSTRAINT "fanmark_transfer_codes_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_transfer_requests"
    ADD CONSTRAINT "fanmark_transfer_requests_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_transfer_requests"
    ADD CONSTRAINT "fanmark_transfer_requests_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."fanmark_licenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_transfer_requests"
    ADD CONSTRAINT "fanmark_transfer_requests_transfer_code_id_fkey" FOREIGN KEY ("transfer_code_id") REFERENCES "public"."fanmark_transfer_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fanmark_licenses"
    ADD CONSTRAINT "fk_fanmark_licenses_fanmark_id" FOREIGN KEY ("fanmark_id") REFERENCES "public"."fanmarks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_rules"
    ADD CONSTRAINT "notification_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



COMMENT ON CONSTRAINT "notification_rules_created_by_fkey" ON "public"."notification_rules" IS 'Set created_by to NULL when user is deleted';



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



COMMENT ON CONSTRAINT "user_roles_created_by_fkey" ON "public"."user_roles" IS 'Set created_by to NULL when user is deleted';



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_invited_by_code_fkey" FOREIGN KEY ("invited_by_code") REFERENCES "public"."invitation_codes"("code");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage all coupons" ON "public"."extension_coupons" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage all lottery entries" ON "public"."fanmark_lottery_entries" USING ("public"."is_admin"());



CREATE POLICY "Admins can manage all usages" ON "public"."extension_coupon_usages" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage all user roles" ON "public"."user_roles" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'admin'::"public"."app_role")))));



CREATE POLICY "Admins can manage emoji master" ON "public"."emoji_master" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage notification rules" ON "public"."notification_rules" USING ("public"."is_admin"());



CREATE POLICY "Admins can manage templates" ON "public"."notification_templates" USING ("public"."is_admin"());



CREATE POLICY "Admins can update all settings" ON "public"."system_settings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can view all notifications" ON "public"."notifications" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view all settings" ON "public"."system_settings" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can view all subscriptions" ON "public"."user_subscriptions" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view lottery history" ON "public"."fanmark_lottery_history" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view notification events" ON "public"."notification_events" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view notification history" ON "public"."notifications_history" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can write audit logs" ON "public"."audit_logs" FOR INSERT WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "Allow admin read fanmark tiers" ON "public"."fanmark_tiers" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Allow admin update fanmark tiers" ON "public"."fanmark_tiers" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Allow authenticated read extension prices" ON "public"."fanmark_tier_extension_prices" FOR SELECT TO "authenticated" USING (("is_active" IS TRUE));



CREATE POLICY "Allow read discoveries" ON "public"."fanmark_discoveries" FOR SELECT USING (true);



CREATE POLICY "Allow read events" ON "public"."fanmark_events" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "Anyone can join waitlist" ON "public"."waitlist" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can view active availability rules" ON "public"."fanmark_availability_rules" FOR SELECT USING (("is_available" = true));



CREATE POLICY "Anyone can view active fanmark licenses for recent activity" ON "public"."fanmark_licenses" FOR SELECT USING (("status" = 'active'::"text"));



CREATE POLICY "Anyone can view active fanmarks" ON "public"."fanmarks" FOR SELECT USING (("status" = 'active'::"text"));



CREATE POLICY "Anyone can view active reserved patterns" ON "public"."reserved_emoji_patterns" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view active tiers" ON "public"."fanmark_tiers" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view public settings" ON "public"."system_settings" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Authenticated users can validate active coupons" ON "public"."extension_coupons" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("is_active" = true) AND (("expires_at" IS NULL) OR ("expires_at" > "now"())) AND ("used_count" < "max_uses")));



CREATE POLICY "Authenticated users can validate transfer codes" ON "public"."fanmark_transfer_codes" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("status" = 'active'::"text")));



CREATE POLICY "Authenticated users can view active templates" ON "public"."notification_templates" FOR SELECT USING ((("is_active" = true) AND ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Authenticated users can view emoji catalog" ON "public"."emoji_master" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view public profiles or own" ON "public"."fanmark_profiles" FOR SELECT TO "authenticated" USING ((("is_public" = true) OR (EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Deny direct access to password configs" ON "public"."fanmark_password_configs" USING (false) WITH CHECK (false);



CREATE POLICY "Enterprise users can view their own settings" ON "public"."enterprise_user_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Fanmarks are accessible to authenticated users" ON "public"."fanmarks" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Issuers can cancel their active transfer codes" ON "public"."fanmark_transfer_codes" FOR UPDATE USING ((("auth"."uid"() = "issuer_user_id") AND ("status" = 'active'::"text"))) WITH CHECK (("status" = 'cancelled'::"text"));



CREATE POLICY "Issuers can view requests for their codes" ON "public"."fanmark_transfer_requests" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_transfer_codes" "tc"
  WHERE (("tc"."id" = "fanmark_transfer_requests"."transfer_code_id") AND ("tc"."issuer_user_id" = "auth"."uid"())))));



CREATE POLICY "Issuers can view their own transfer codes" ON "public"."fanmark_transfer_codes" FOR SELECT USING (("auth"."uid"() = "issuer_user_id"));



CREATE POLICY "Only admins can manage all licenses" ON "public"."fanmark_licenses" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Only admins can manage availability rules" ON "public"."fanmark_availability_rules" USING ("public"."is_admin"());



CREATE POLICY "Only admins can manage enterprise user settings" ON "public"."enterprise_user_settings" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Only admins can manage invitation codes" ON "public"."invitation_codes" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Only admins can manage tiers" ON "public"."fanmark_tiers" USING ("public"."is_admin"());



CREATE POLICY "Owners can view their fanmark access logs" ON "public"."fanmark_access_logs" FOR SELECT USING (("fanmark_id" IN ( SELECT "fl"."fanmark_id"
   FROM "public"."fanmark_licenses" "fl"
  WHERE ("fl"."user_id" = "auth"."uid"()))));



CREATE POLICY "Owners can view their fanmark daily stats" ON "public"."fanmark_access_daily_stats" FOR SELECT USING (("fanmark_id" IN ( SELECT "fl"."fanmark_id"
   FROM "public"."fanmark_licenses" "fl"
  WHERE ("fl"."user_id" = "auth"."uid"()))));



CREATE POLICY "Requesters can view their own transfer requests" ON "public"."fanmark_transfer_requests" FOR SELECT USING (("auth"."uid"() = "requester_user_id"));



CREATE POLICY "Service role can manage all subscriptions" ON "public"."user_subscriptions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "System can create lottery history" ON "public"."fanmark_lottery_history" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "System can insert usages" ON "public"."extension_coupon_usages" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "System can manage all notifications" ON "public"."notifications" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "System can manage all transfer codes" ON "public"."fanmark_transfer_codes" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "System can manage all transfer requests" ON "public"."fanmark_transfer_requests" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));



CREATE POLICY "System can manage notification events" ON "public"."notification_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can cancel their pending entries" ON "public"."fanmark_lottery_entries" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("entry_status" = 'pending'::"text"))) WITH CHECK (("entry_status" = ANY (ARRAY['cancelled'::"text", 'pending'::"text"])));



CREATE POLICY "Users can create entries for grace licenses" ON "public"."fanmark_lottery_entries" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_lottery_entries"."license_id") AND ("fl"."status" = 'grace'::"text") AND ("fl"."grace_expires_at" > "now"()))))));



CREATE POLICY "Users can create profiles for their own licenses" ON "public"."fanmark_profiles" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND ("fl"."license_end" > "now"())))));



CREATE POLICY "Users can delete their own profiles" ON "public"."fanmark_profiles" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert their own settings" ON "public"."user_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage configs for their own licenses" ON "public"."fanmark_basic_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_basic_configs"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND (("fl"."license_end" IS NULL) OR ("fl"."license_end" > "now"()))))));



CREATE POLICY "Users can manage messageboard configs for their own licenses" ON "public"."fanmark_messageboard_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_messageboard_configs"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND (("fl"."license_end" IS NULL) OR ("fl"."license_end" > "now"()))))));



CREATE POLICY "Users can manage redirect configs for their own licenses" ON "public"."fanmark_redirect_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_redirect_configs"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND (("fl"."license_end" IS NULL) OR ("fl"."license_end" > "now"()))))));



CREATE POLICY "Users can manage their own preferences" ON "public"."notification_preferences" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profiles" ON "public"."fanmark_profiles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own settings" ON "public"."user_settings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can validate invitation codes" ON "public"."invitation_codes" FOR SELECT TO "authenticated" USING ((("is_active" = true) AND (("expires_at" IS NULL) OR ("expires_at" > "now"()))));



CREATE POLICY "Users can view their own audit logs" ON "public"."audit_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own entries" ON "public"."fanmark_lottery_entries" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own licenses" ON "public"."fanmark_licenses" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own settings" ON "public"."user_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own subscriptions" ON "public"."user_subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own usages" ON "public"."extension_coupon_usages" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage favorites" ON "public"."fanmark_favorites" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Waitlist access only through secure functions" ON "public"."waitlist" FOR SELECT USING (false);



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."emoji_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enterprise_user_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_coupon_usages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_access_daily_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_access_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_availability_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_basic_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_discoveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_licenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_lottery_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_lottery_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_messageboard_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_password_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_redirect_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_tier_extension_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_transfer_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmark_transfer_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fanmarks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitation_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reserved_emoji_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."add_fanmark_favorite"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."add_fanmark_favorite"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_fanmark_favorite"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."archive_old_notifications"("days_old" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."archive_old_notifications"("days_old" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_old_notifications"("days_old" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_fanmark_availability"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."check_fanmark_availability"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_fanmark_availability"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_fanmark_availability_secure"("fanmark_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_fanmark_availability_secure"("fanmark_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_fanmark_availability_secure"("fanmark_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_username_availability_secure"("username_to_check" "text", "current_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_username_availability_secure"("username_to_check" "text", "current_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_username_availability_secure"("username_to_check" "text", "current_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."classify_fanmark_tier"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."classify_fanmark_tier"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."classify_fanmark_tier"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."count_fanmark_emoji_units"("input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."count_fanmark_emoji_units"("input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_fanmark_emoji_units"("input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_notification_event"("event_type_param" "text", "payload_param" "jsonb", "source_param" "text", "dedupe_key_param" "text", "trigger_at_param" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification_event"("event_type_param" "text", "payload_param" "jsonb", "source_param" "text", "dedupe_key_param" "text", "trigger_at_param" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification_event"("event_type_param" "text", "payload_param" "jsonb", "source_param" "text", "dedupe_key_param" "text", "trigger_at_param" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_safe_display_name"("user_email" "text", "user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_safe_display_name"("user_email" "text", "user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_safe_display_name"("user_email" "text", "user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_transfer_code_string"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_transfer_code_string"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_transfer_code_string"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_fanmark_by_emoji"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_fanmark_by_emoji"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_fanmark_by_emoji"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_fanmark_by_short_id"("shortid_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_fanmark_by_short_id"("shortid_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_fanmark_by_short_id"("shortid_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_fanmark_complete_data"("fanmark_id_param" "uuid", "emoji_ids_param" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_fanmark_complete_data"("fanmark_id_param" "uuid", "emoji_ids_param" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_fanmark_complete_data"("fanmark_id_param" "uuid", "emoji_ids_param" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_fanmark_details_by_short_id"("shortid_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_fanmark_details_by_short_id"("shortid_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_fanmark_details_by_short_id"("shortid_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_fanmark_ownership_status"("fanmark_license_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_fanmark_ownership_status"("fanmark_license_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_fanmark_ownership_status"("fanmark_license_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_favorite_fanmarks"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_favorite_fanmarks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_favorite_fanmarks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_emoji_profile"("profile_license_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_emoji_profile"("profile_license_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_emoji_profile"("profile_license_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_fanmark_profile"("profile_fanmark_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_fanmark_profile"("profile_fanmark_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_fanmark_profile"("profile_fanmark_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unread_notification_count"("user_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_unread_notification_count"("user_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unread_notification_count"("user_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_waitlist_email_by_id"("waitlist_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_waitlist_email_by_id"("waitlist_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_waitlist_email_by_id"("waitlist_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_waitlist_secure"("p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_waitlist_secure"("p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_waitlist_secure"("p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_transfer"("license_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_transfer"("license_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_transfer"("license_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_fanmark_licensed"("fanmark_license_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_fanmark_licensed"("fanmark_license_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_fanmark_licensed"("fanmark_license_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_fanmark_password_protected"("fanmark_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_fanmark_password_protected"("fanmark_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_fanmark_password_protected"("fanmark_uuid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."link_fanmark_discovery"("new_fanmark_id" "uuid", "normalized_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."link_fanmark_discovery"("new_fanmark_id" "uuid", "normalized_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_fanmark_discovery"("new_fanmark_id" "uuid", "normalized_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."link_fanmark_discovery_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."link_fanmark_discovery_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_fanmark_discovery_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_recent_fanmarks"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."list_recent_fanmarks"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_recent_fanmarks"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."log_emoji_master_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_emoji_master_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_emoji_master_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_lottery_entry_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_lottery_entry_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_lottery_entry_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_profile_cache_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_profile_cache_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_profile_cache_access"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_waitlist_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_waitlist_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_waitlist_access"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"("user_id_param" "uuid", "read_via_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"("user_id_param" "uuid", "read_via_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"("user_id_param" "uuid", "read_via_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_notification_read"("notification_id_param" "uuid", "read_via_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_notification_read"("notification_id_param" "uuid", "read_via_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notification_read"("notification_id_param" "uuid", "read_via_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_emoji_ids"("input_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_emoji_ids"("input_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_emoji_ids"("input_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_security_breach"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_security_breach"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_security_breach"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_fanmark_search"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."record_fanmark_search"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_fanmark_search"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_fanmark_favorite"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."remove_fanmark_favorite"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_fanmark_favorite"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."render_notification_template"("template_id_param" "uuid", "template_version_param" integer, "payload_param" "jsonb", "language_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."render_notification_template"("template_id_param" "uuid", "template_version_param" integer, "payload_param" "jsonb", "language_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_notification_template"("template_id_param" "uuid", "template_version_param" integer, "payload_param" "jsonb", "language_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_fanmarks_with_lottery"("input_emoji_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."search_fanmarks_with_lottery"("input_emoji_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_fanmarks_with_lottery"("input_emoji_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."seq_key"("normalized_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."seq_key"("normalized_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."seq_key"("normalized_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_public_profile_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_public_profile_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_public_profile_cache"() TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_fanmark_favorite"("fanmark_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_fanmark_favorite"("fanmark_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_fanmark_favorite"("fanmark_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_fanmark_discovery"("input_emoji_ids" "uuid"[], "increment_search" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_fanmark_discovery"("input_emoji_ids" "uuid"[], "increment_search" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_fanmark_discovery"("input_emoji_ids" "uuid"[], "increment_search" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_fanmark_password_config"("license_uuid" "uuid", "new_password" "text", "enable_password" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_fanmark_password_config"("license_uuid" "uuid", "new_password" "text", "enable_password" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_fanmark_password_config"("license_uuid" "uuid", "new_password" "text", "enable_password" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."use_invitation_code"("code_to_use" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."use_invitation_code"("code_to_use" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_invitation_code"("code_to_use" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_display_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_display_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_display_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_invitation_code"("code_to_check" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_invitation_code"("code_to_check" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_invitation_code"("code_to_check" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_fanmark_password"("fanmark_uuid" "uuid", "provided_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_fanmark_password"("fanmark_uuid" "uuid", "provided_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_fanmark_password"("fanmark_uuid" "uuid", "provided_password" "text") TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."emoji_master" TO "anon";
GRANT ALL ON TABLE "public"."emoji_master" TO "authenticated";
GRANT ALL ON TABLE "public"."emoji_master" TO "service_role";



GRANT ALL ON TABLE "public"."enterprise_user_settings" TO "anon";
GRANT ALL ON TABLE "public"."enterprise_user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."enterprise_user_settings" TO "service_role";



GRANT ALL ON TABLE "public"."extension_coupon_usages" TO "anon";
GRANT ALL ON TABLE "public"."extension_coupon_usages" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_coupon_usages" TO "service_role";



GRANT ALL ON TABLE "public"."extension_coupons" TO "anon";
GRANT ALL ON TABLE "public"."extension_coupons" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_coupons" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_access_daily_stats" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_access_daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_access_daily_stats" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_access_logs" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_access_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_access_logs" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_availability_rules" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_availability_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_availability_rules" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_basic_configs" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_basic_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_basic_configs" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_discoveries" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_discoveries" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_discoveries" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_events" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_events" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."fanmark_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."fanmark_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fanmark_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_favorites" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_licenses" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_licenses" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_licenses" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_lottery_entries" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_lottery_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_lottery_entries" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_lottery_history" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_lottery_history" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_lottery_history" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_messageboard_configs" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_messageboard_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_messageboard_configs" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_password_configs" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_password_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_password_configs" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_profiles" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_redirect_configs" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_redirect_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_redirect_configs" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_tier_extension_prices" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_tier_extension_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_tier_extension_prices" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_tiers" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_transfer_codes" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_transfer_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_transfer_codes" TO "service_role";



GRANT ALL ON TABLE "public"."fanmark_transfer_requests" TO "anon";
GRANT ALL ON TABLE "public"."fanmark_transfer_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmark_transfer_requests" TO "service_role";



GRANT ALL ON TABLE "public"."fanmarks" TO "anon";
GRANT ALL ON TABLE "public"."fanmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."fanmarks" TO "service_role";



GRANT ALL ON TABLE "public"."invitation_codes" TO "anon";
GRANT ALL ON TABLE "public"."invitation_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."invitation_codes" TO "service_role";



GRANT ALL ON TABLE "public"."notification_events" TO "anon";
GRANT ALL ON TABLE "public"."notification_events" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_events" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notification_rules" TO "anon";
GRANT ALL ON TABLE "public"."notification_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_rules" TO "service_role";



GRANT ALL ON TABLE "public"."notification_templates" TO "anon";
GRANT ALL ON TABLE "public"."notification_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_templates" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."notifications_history" TO "anon";
GRANT ALL ON TABLE "public"."notifications_history" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications_history" TO "service_role";



GRANT ALL ON TABLE "public"."recent_active_fanmarks" TO "anon";
GRANT ALL ON TABLE "public"."recent_active_fanmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."recent_active_fanmarks" TO "service_role";



GRANT ALL ON TABLE "public"."reserved_emoji_patterns" TO "anon";
GRANT ALL ON TABLE "public"."reserved_emoji_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."reserved_emoji_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist" TO "anon";
GRANT ALL ON TABLE "public"."waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
