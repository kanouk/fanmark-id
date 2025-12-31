-- Add display_fanmark to licenses and favorites
alter table public.fanmark_licenses
  add column if not exists display_fanmark text;

alter table public.fanmark_favorites
  add column if not exists display_fanmark text;

-- Update recent_active_fanmarks to use license display_fanmark
create or replace view public.recent_active_fanmarks with (security_invoker = 'true') as
  select
    fl.id as license_id,
    fl.fanmark_id,
    f.short_id as fanmark_short_id,
    fl.display_fanmark as display_emoji,
    fl.created_at as license_created_at
  from public.fanmark_licenses fl
  join public.fanmarks f on f.id = fl.fanmark_id
  where fl.status = 'active';

-- Update favorite RPCs to store/display display_fanmark

drop function if exists public.add_fanmark_favorite(uuid[]);

create or replace function public.add_fanmark_favorite(input_emoji_ids uuid[], input_display_fanmark text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
begin
  select auth.uid() into auth_user_id;
  if auth_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  if normalized_ids is null or array_length(normalized_ids, 1) = 0 then
    raise exception 'Invalid emoji ids';
  end if;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  select fanmark_id into linked_fanmark_id
  from public.fanmark_discoveries
  where id = discovery_id;

  insert into public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids,
    display_fanmark
  )
  values (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids,
    input_display_fanmark
  )
  on conflict (user_id, seq_key(normalized_emoji_ids))
  do nothing;

  if not found then
    return false;
  end if;

  update public.fanmark_discoveries
  set favorite_count = favorite_count + 1
  where id = discovery_id;

  insert into public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  values ('favorite_add', auth_user_id, discovery_id, normalized_ids);

  return true;
end;
$function$;


drop function if exists public.get_favorite_fanmarks();

create or replace function public.get_favorite_fanmarks()
 returns table(
  favorite_id uuid,
  discovery_id uuid,
  favorited_at timestamp with time zone,
  fanmark_id uuid,
  display_fanmark text,
  normalized_emoji_ids uuid[],
  emoji_ids uuid[],
  sequence_key uuid,
  availability_status text,
  search_count bigint,
  favorite_count bigint,
  short_id text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  is_password_protected boolean
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  auth_user_id uuid;
begin
  select auth.uid() into auth_user_id;
  if auth_user_id is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    ff.id as favorite_id,
    ff.discovery_id,
    ff.created_at as favorited_at,
    d.fanmark_id,
    ff.display_fanmark,
    ff.normalized_emoji_ids,
    d.emoji_ids,
    seq_key(d.normalized_emoji_ids) as sequence_key,
    d.availability_status,
    d.search_count,
    d.favorite_count,
    f.short_id,
    bc.fanmark_name,
    bc.access_type,
    rc.target_url,
    mc.content as text_content,
    us.username as current_owner_username,
    us.display_name as current_owner_display_name,
    fl.license_start as current_license_start,
    fl.license_end as current_license_end,
    fl.status as current_license_status,
    coalesce(pc.is_enabled, false) as is_password_protected
  from public.fanmark_favorites ff
  join public.fanmark_discoveries d on d.id = ff.discovery_id
  left join public.fanmarks f on f.id = d.fanmark_id
  left join lateral (
    select fl_inner.*
    from public.fanmark_licenses fl_inner
    where fl_inner.fanmark_id = f.id
    order by fl_inner.license_end desc nulls last
    limit 1
  ) fl on true
  left join public.user_settings us on us.user_id = fl.user_id
  left join public.fanmark_basic_configs bc on bc.license_id = fl.id
  left join public.fanmark_redirect_configs rc on rc.license_id = fl.id
  left join public.fanmark_messageboard_configs mc on mc.license_id = fl.id
  left join public.fanmark_password_configs pc on pc.license_id = fl.id
  where ff.user_id = auth_user_id
  order by ff.created_at desc;
end;
$function$;

-- Update fanmark fetch RPCs to include display_fanmark

drop function if exists public.get_fanmark_by_emoji(uuid[]);

create or replace function public.get_fanmark_by_emoji(input_emoji_ids uuid[])
 returns table(
  id uuid,
  user_input_fanmark text,
  display_fanmark text,
  emoji_ids uuid[],
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean,
  short_id text
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  normalized_ids uuid[];
begin
  if input_emoji_ids is null or array_length(input_emoji_ids, 1) = 0 then
    return;
  end if;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  if normalized_ids is null or array_length(normalized_ids, 1) = 0 then
    return;
  end if;

  return query
  select
    f.id,
    f.user_input_fanmark,
    fl.display_fanmark,
    f.emoji_ids,
    coalesce(bc.fanmark_name, f.user_input_fanmark) as fanmark_name,
    coalesce(bc.access_type, 'inactive') as access_type,
    rc.target_url,
    mc.content as text_content,
    f.status,
    coalesce(pc.is_enabled, false) as is_password_protected,
    f.short_id
  from fanmarks f
  left join fanmark_licenses fl on f.id = fl.fanmark_id
    and fl.status = 'active'
    and fl.license_end > now()
  left join fanmark_basic_configs bc on fl.id = bc.license_id
  left join fanmark_redirect_configs rc on fl.id = rc.license_id
  left join fanmark_messageboard_configs mc on fl.id = mc.license_id
  left join fanmark_password_configs pc on fl.id = pc.license_id
  where f.normalized_emoji_ids = normalized_ids
    and f.status = 'active';
end;
$function$;


drop function if exists public.get_fanmark_by_short_id(text);

create or replace function public.get_fanmark_by_short_id(shortid_param text)
 returns table(
  id uuid,
  short_id text,
  user_input_fanmark text,
  display_fanmark text,
  emoji_ids uuid[],
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean,
  license_id uuid,
  license_status text,
  license_end timestamp with time zone,
  grace_expires_at timestamp with time zone,
  is_returned boolean
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  select
    f.id,
    f.short_id,
    f.user_input_fanmark,
    fl.display_fanmark,
    f.emoji_ids,
    coalesce(bc.fanmark_name, f.user_input_fanmark) as fanmark_name,
    coalesce(bc.access_type, 'inactive') as access_type,
    rc.target_url,
    mc.content as text_content,
    f.status,
    coalesce(pc.is_enabled, false) as is_password_protected,
    fl.id as license_id,
    fl.status as license_status,
    fl.license_end,
    fl.grace_expires_at,
    fl.is_returned
  from fanmarks f
  left join lateral (
    select fl_inner.*
    from fanmark_licenses fl_inner
    where fl_inner.fanmark_id = f.id
      and fl_inner.status in ('active', 'grace')
    order by fl_inner.license_end desc nulls last
    limit 1
  ) fl on true
  left join fanmark_basic_configs bc on fl.id = bc.license_id
  left join fanmark_redirect_configs rc on fl.id = rc.license_id
  left join fanmark_messageboard_configs mc on fl.id = mc.license_id
  left join fanmark_password_configs pc on fl.id = pc.license_id
  where f.short_id = shortid_param
    and f.status = 'active';
end;
$function$;


drop function if exists public.get_fanmark_complete_data(uuid, uuid[]);

create or replace function public.get_fanmark_complete_data(
  fanmark_id_param uuid default null::uuid,
  emoji_ids_param uuid[] default null::uuid[]
)
 returns table(
  id uuid,
  user_input_fanmark text,
  display_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  access_type text,
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  fanmark_name text,
  target_url text,
  text_content text,
  is_password_protected boolean,
  current_owner_id uuid,
  license_end timestamp with time zone,
  has_active_license boolean,
  license_id uuid,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  is_blocked_for_registration boolean,
  next_available_at timestamp with time zone,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  emoji_sequence text;
  normalized_input text;
  missing_count int;
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if fanmark_id_param is null and (emoji_ids_param is null or array_length(emoji_ids_param, 1) = 0) then
    return;
  end if;

  if fanmark_id_param is null then
    with resolved as (
      select em.emoji, ids.ord
      from unnest(emoji_ids_param) with ordinality as ids(id, ord)
      left join public.emoji_master em on em.id = ids.id
    )
    select
      count(*) filter (where emoji is null),
      string_agg(emoji, '' order by ord)
    into missing_count, emoji_sequence
    from resolved;

    if missing_count > 0 or emoji_sequence is null or emoji_sequence = '' then
      return;
    end if;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''
    );
  end if;

  return query
  select
    f.id,
    f.user_input_fanmark,
    latest.display_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    coalesce(bc.access_type, 'inactive') as access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content as text_content,
    coalesce(pc.is_enabled, false) as is_password_protected,
    latest.user_id as current_owner_id,
    latest.license_end,
    case
      when latest.status = 'active' and (latest.license_end is null or latest.license_end > now()) then true
      else false
    end as has_active_license,
    latest.id as license_id,
    latest.status as current_license_status,
    latest.grace_expires_at as current_grace_expires_at,
    case
      when latest.status = 'active' and (latest.license_end is null or latest.license_end > now()) then true
      when latest.status = 'grace' and coalesce(latest.grace_expires_at, latest.license_end) > now() then true
      else false
    end as is_blocked_for_registration,
    case
      when latest.status = 'grace' and coalesce(latest.grace_expires_at, latest.license_end) > now() then coalesce(latest.grace_expires_at, latest.license_end)
      when latest.status = 'active' and (latest.license_end is null or latest.license_end > now()) then latest.license_end
      else null
    end as next_available_at,
    coalesce(lottery_info.entry_count, 0) as lottery_entry_count,
    coalesce(lottery_info.has_entry, false) as has_user_lottery_entry,
    lottery_info.user_entry_id as user_lottery_entry_id
  from fanmarks f
  left join lateral (
    select fl.*
    from fanmark_licenses fl
    where fl.fanmark_id = f.id
    order by (fl.license_end is null) desc, fl.license_end desc
    limit 1
  ) as latest on true
  left join fanmark_basic_configs bc on latest.id = bc.license_id
  left join fanmark_redirect_configs rc on latest.id = rc.license_id
  left join fanmark_messageboard_configs mc on latest.id = mc.license_id
  left join fanmark_password_configs pc on latest.id = pc.license_id
  left join lateral (
    select
      count(*) as entry_count,
      bool_or(fle.user_id = current_user_id) as has_entry,
      (select fle2.id from fanmark_lottery_entries fle2
       where fle2.fanmark_id = f.id
         and fle2.user_id = current_user_id
         and fle2.entry_status = 'pending'
       limit 1) as user_entry_id
    from fanmark_lottery_entries fle
    where fle.fanmark_id = f.id
      and fle.entry_status = 'pending'
  ) as lottery_info on true
  where
    (fanmark_id_param is not null and f.id = fanmark_id_param)
    or
    (fanmark_id_param is null and normalized_input is not null and f.normalized_emoji = normalized_input);
end;
$function$;


drop function if exists public.get_fanmark_details_by_short_id(text);

create or replace function public.get_fanmark_details_by_short_id(shortid_param text)
 returns table(
  fanmark_id uuid,
  user_input_fanmark text,
  display_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  current_is_returned boolean,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid,
  current_owner_id uuid
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fanmark_record record;
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  select f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
    into fanmark_record
  from public.fanmarks f
  where f.short_id = shortid_param
    and f.status = 'active';

  if not found then
    return;
  end if;

  return query
  with latest_license as (
    select
      fl.id as license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      fl.is_returned,
      fl.display_fanmark,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    from public.fanmark_licenses fl
    left join public.user_settings us on fl.user_id = us.user_id
    where fl.fanmark_id = fanmark_record.id
    order by fl.license_end desc
    limit 1
  ),
  first_license as (
    select
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    from public.fanmark_licenses fl
    left join public.user_settings us on fl.user_id = us.user_id
    where fl.fanmark_id = fanmark_record.id
    order by fl.license_start asc
    limit 1
  ),
  history as (
    select
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
        ) order by fl.license_start desc
      ) as history_data
    from public.fanmark_licenses fl
    left join public.user_settings us on fl.user_id = us.user_id
    where fl.fanmark_id = fanmark_record.id
  ),
  favorite_status as (
    select exists (
      select 1
      from public.fanmark_favorites ff
      where ff.fanmark_id = fanmark_record.id
        and ff.user_id = current_user_id
    ) as is_fav
  ),
  lottery_info as (
    select
      count(*) as entry_count,
      bool_or(fle.user_id = current_user_id) as has_entry,
      (select fle2.id
       from public.fanmark_lottery_entries fle2
       where fle2.fanmark_id = fanmark_record.id
         and fle2.user_id = current_user_id
         and fle2.entry_status = 'pending'
       limit 1) as user_entry_id
    from public.fanmark_lottery_entries fle
    where fle.fanmark_id = fanmark_record.id
      and fle.entry_status = 'pending'
  )
  select
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    ll.display_fanmark,
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
    case when ll.status = 'active' and ll.license_end > now() then true else false end as is_currently_active,

    fl.first_date,
    fl.first_username,
    fl.first_display_name,

    coalesce(h.history_data, '[]'::jsonb),
    coalesce(fs.is_fav, false),

    coalesce(li.entry_count, 0)::bigint,
    coalesce(li.has_entry, false),
    li.user_entry_id,
    ll.user_id
  from (select 1) as dummy
  left join latest_license ll on true
  left join first_license fl on true
  left join history h on true
  left join favorite_status fs on true
  left join lottery_info li on true;
end;
$function$;
