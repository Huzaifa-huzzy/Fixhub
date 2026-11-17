create table public.username_registration_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);

create index username_registration_rate_limits_window_idx
  on public.username_registration_rate_limits (window_started_at);

alter table public.username_registration_rate_limits enable row level security;
revoke all on public.username_registration_rate_limits from public, anon, authenticated;

create or replace function public.consume_username_registration_attempt(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid registration rate-limit key';
  end if;

  delete from public.username_registration_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.username_registration_rate_limits as current_limit (
    ip_hash,
    window_started_at,
    attempts
  )
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
  set
    window_started_at = case
      when current_limit.window_started_at <= now() - interval '1 hour' then now()
      else current_limit.window_started_at
    end,
    attempts = case
      when current_limit.window_started_at <= now() - interval '1 hour' then 1
      else current_limit.attempts + 1
    end
  returning attempts into v_attempts;

  return v_attempts <= 5;
end;
$$;

revoke all on function public.consume_username_registration_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_username_registration_attempt(text) to service_role;

notify pgrst, 'reload schema';
