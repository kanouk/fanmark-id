-- Update admin helper functions to use user_settings.plan_type
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
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

comment on function public.is_admin is
'Returns TRUE when the current authenticated user has the admin plan';

revoke all on function public.is_admin from public;
grant execute on function public.is_admin() to authenticated;

-- Align is_super_admin with the new admin detection and keep security logging
create or replace function public.is_super_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
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

comment on function public.is_super_admin is
'Additional guard for critical operations. Requires admin plan and a recent valid session.';

revoke all on function public.is_super_admin from public;
grant execute on function public.is_super_admin() to authenticated;
