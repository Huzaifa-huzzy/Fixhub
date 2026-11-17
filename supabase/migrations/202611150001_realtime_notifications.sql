create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  event_key text not null,
  kind text not null check (kind in ('chat', 'report', 'verification', 'booking', 'account', 'platform')),
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 500),
  data jsonb not null default '{}'::jsonb,
  push_status text not null default 'pending'
    check (push_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  push_error text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_profile_event_unique unique (profile_id, event_key)
);

create index notifications_profile_created_idx
  on public.notifications (profile_id, created_at desc);
create index notifications_unread_profile_idx
  on public.notifications (profile_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

create policy "Users can read their own notifications"
on public.notifications for select to authenticated
using (profile_id = (select auth.uid()));

create policy "Users can mark their own notifications as read"
on public.notifications for update to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

create table public.notification_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

create policy "Users can manage their own notification preferences"
on public.notification_preferences for all to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

create trigger notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

insert into public.notification_preferences (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

create or replace function public.add_notification(
  target_profile_id uuid,
  target_event_key text,
  target_kind text,
  target_title text,
  target_body text,
  target_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_id uuid;
begin
  if target_profile_id is null or target_event_key is null or length(target_event_key) > 500 then
    raise exception 'A valid notification recipient and event key are required';
  end if;

  insert into public.notifications (
    profile_id, event_key, kind, title, body, data
  )
  values (
    target_profile_id,
    target_event_key,
    target_kind,
    left(trim(target_title), 160),
    left(trim(target_body), 500),
    coalesce(target_data, '{}'::jsonb)
  )
  on conflict (profile_id, event_key) do nothing
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.add_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.notify_serviceconnect_admins(
  target_event_key text,
  target_kind text,
  target_title text,
  target_body text,
  target_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_profile record;
begin
  for admin_profile in
    select id from public.profiles where role = 'admin'
  loop
    perform public.add_notification(
      admin_profile.id,
      target_event_key,
      target_kind,
      target_title,
      target_body,
      target_data
    );
  end loop;
end;
$$;

revoke all on function public.notify_serviceconnect_admins(text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.notify_new_provider_registration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role is distinct from new.role and new.role = 'provider' then
    perform public.notify_serviceconnect_admins(
      'provider-registered:' || new.id::text,
      'platform',
      'New provider registered',
      coalesce(nullif(trim(new.name), ''), 'A provider') || ' joined Fixhub.',
      jsonb_build_object('destination', 'profile', 'profile_id', new.id)
    );
  end if;
  return new;
end;
$$;

create trigger profiles_notify_new_provider
after update of role on public.profiles
for each row execute function public.notify_new_provider_registration();

create or replace function public.notify_provider_verification_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient_name text;
  admin_event_key text;
begin
  if tg_op = 'UPDATE' and old.verification_status is distinct from new.verification_status
    and new.verification_status in ('verified', 'rejected') then
    perform public.add_notification(
      new.profile_id,
      'provider-verification-result:' || new.id::text || ':' || new.verification_status::text
        || ':' || new.updated_at::text,
      'verification',
      case when new.verification_status = 'verified'
        then 'Provider verification approved'
        else 'Provider verification needs attention'
      end,
      case when new.verification_status = 'verified'
        then 'Your CNIC and selfie verification was approved.'
        else coalesce(nullif(trim(new.rejection_reason), ''), 'Review your verification details and submit them again.')
      end,
      jsonb_build_object('destination', 'verification', 'provider_profile_id', new.id)
    );
  end if;

  if new.cnic_number is not null
    and new.cnic_front_url is not null
    and new.cnic_back_url is not null
    and new.cnic_selfie_url is not null
    and new.verification_status = 'pending'
    and (
      tg_op = 'INSERT'
      or old.cnic_number is distinct from new.cnic_number
      or old.cnic_front_url is distinct from new.cnic_front_url
      or old.cnic_back_url is distinct from new.cnic_back_url
      or old.cnic_selfie_url is distinct from new.cnic_selfie_url
      or old.verification_status = 'rejected'
    ) then
    select name into recipient_name from public.profiles where id = new.profile_id;
    admin_event_key := 'provider-verification-submitted:' || new.id::text || ':' ||
      md5(concat_ws('|', new.cnic_number, new.cnic_front_url, new.cnic_back_url, new.cnic_selfie_url))
      || ':' || new.updated_at::text;
    perform public.notify_serviceconnect_admins(
      admin_event_key,
      'verification',
      'Provider verification submitted',
      coalesce(nullif(trim(recipient_name), ''), 'A provider') || ' submitted CNIC and selfie documents.',
      jsonb_build_object('destination', 'profile', 'provider_profile_id', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger provider_profiles_notify_verification
after insert or update of verification_status, cnic_number, cnic_front_url, cnic_back_url, cnic_selfie_url
on public.provider_profiles
for each row execute function public.notify_provider_verification_events();

create or replace function public.notify_new_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender_name text;
begin
  if new.sender_id = new.receiver_id then
    return new;
  end if;

  select name into sender_name
  from public.profiles
  where id = new.sender_id;

  perform public.add_notification(
    new.receiver_id,
    'chat-message:' || new.id::text,
    'chat',
    'New message from ' || coalesce(nullif(trim(sender_name), ''), 'a Fixhub user'),
    'You have a new message.',
    jsonb_build_object(
      'destination', 'chat',
      'chat_id', new.chat_id,
      'other_profile_id', new.sender_id,
      'provider_name', coalesce(nullif(trim(sender_name), ''), 'Fixhub user')
    )
  );
  return new;
end;
$$;

create trigger messages_create_notification
after insert on public.messages
for each row execute function public.notify_new_chat_message();

create or replace function public.notify_report_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and not old.submitted and new.submitted then
    perform public.notify_serviceconnect_admins(
      'report-submitted:' || new.id::text,
      'report',
      'New report submitted',
      left(new.title, 140),
      jsonb_build_object('destination', 'profile', 'report_id', new.id)
    );
  end if;

  if tg_op = 'UPDATE'
    and old.submitted and new.submitted
    and old.status is distinct from new.status then
    perform public.add_notification(
      new.reporter_id,
      'report-status:' || new.id::text || ':' || new.status || ':' || new.updated_at::text,
      'report',
      'Report status updated',
      'Your report "' || left(new.title, 100) || '" is now ' || new.status || '.',
      jsonb_build_object('destination', 'profile', 'report_id', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger reports_create_notifications
after update of submitted, status on public.reports
for each row execute function public.notify_report_events();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

drop policy if exists "Providers can manage their own push tokens" on public.provider_push_tokens;
create policy "Users can manage their own push tokens"
on public.provider_push_tokens for all to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));
grant all on public.provider_push_tokens to service_role;

delete from public.provider_push_tokens older
using public.provider_push_tokens newer
where older.expo_push_token = newer.expo_push_token
  and (
    older.updated_at < newer.updated_at
    or (older.updated_at = newer.updated_at and older.profile_id < newer.profile_id)
  );

create unique index provider_push_tokens_device_token_unique
  on public.provider_push_tokens (expo_push_token);

create or replace function public.register_my_push_token(target_expo_push_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Sign in to register push notifications'
      using errcode = '42501';
  end if;
  if target_expo_push_token is null
    or not (
      target_expo_push_token like 'ExponentPushToken[%]'
      or target_expo_push_token like 'ExpoPushToken[%]'
    ) then
    raise exception 'Invalid Expo push token';
  end if;

  delete from public.provider_push_tokens
  where expo_push_token = target_expo_push_token;

  insert into public.provider_push_tokens (profile_id, expo_push_token, updated_at)
  values (current_profile_id, target_expo_push_token, now());
end;
$$;

revoke all on function public.register_my_push_token(text) from public, anon;
grant execute on function public.register_my_push_token(text) to authenticated;

create or replace function public.unregister_my_push_token(target_expo_push_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to unregister push notifications'
      using errcode = '42501';
  end if;
  delete from public.provider_push_tokens
  where profile_id = auth.uid()
    and expo_push_token = target_expo_push_token;
end;
$$;

revoke all on function public.unregister_my_push_token(text) from public, anon;
grant execute on function public.unregister_my_push_token(text) to authenticated;

notify pgrst, 'reload schema';
