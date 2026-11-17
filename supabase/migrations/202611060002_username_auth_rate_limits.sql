create table public.username_auth_rate_limits (
  action text not null check (action in ('login', 'recovery')),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  username_hash text not null check (username_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  primary key (action, ip_hash, username_hash)
);

create index username_auth_rate_limits_window_idx
  on public.username_auth_rate_limits (window_started_at);

alter table public.username_auth_rate_limits enable row level security;
revoke all on public.username_auth_rate_limits from public, anon, authenticated;

create or replace function public.consume_username_auth_attempt(
  p_action text,
  p_ip_hash text,
  p_username_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_window interval;
  v_limit integer;
begin
  if p_action not in ('login', 'recovery')
    or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_username_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid username authentication rate-limit key';
  end if;

  if p_action = 'login' then
    v_window := interval '15 minutes';
    v_limit := 10;
  else
    v_window := interval '1 hour';
    v_limit := 3;
  end if;

  delete from public.username_auth_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.username_auth_rate_limits as current_limit (
    action,
    ip_hash,
    username_hash,
    window_started_at,
    attempts
  )
  values (p_action, p_ip_hash, p_username_hash, now(), 1)
  on conflict (action, ip_hash, username_hash) do update
  set
    window_started_at = case
      when current_limit.window_started_at <= now() - v_window then now()
      else current_limit.window_started_at
    end,
    attempts = case
      when current_limit.window_started_at <= now() - v_window then 1
      else current_limit.attempts + 1
    end
  returning attempts into v_attempts;

  return v_attempts <= v_limit;
end;
$$;

revoke all on function public.consume_username_auth_attempt(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_username_auth_attempt(text, text, text) to service_role;

notify pgrst, 'reload schema';
