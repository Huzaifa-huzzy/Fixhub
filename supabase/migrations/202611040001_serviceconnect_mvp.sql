create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text unique,
  role text check (role in ('provider', 'taker', 'business_owner', 'admin')),
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.is_serviceconnect_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if auth.uid() = old.id then
      if new.phone is distinct from old.phone then
        raise exception 'Phone numbers are managed by authentication';
      end if;
      if old.role is not null and new.role is distinct from old.role then
        raise exception 'Account role cannot be changed';
      end if;
      if old.role is null and new.role not in ('provider', 'taker', 'business_owner') then
        raise exception 'Invalid account role';
      end if;
    elsif not public.is_serviceconnect_admin() then
      raise exception 'You cannot update another profile';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger profiles_protect_fields
before update on public.profiles
for each row execute function public.protect_profile_fields();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do update set phone = excluded.phone;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace view public.public_profiles
with (security_invoker = false)
as
select id, name, avatar_url, role
from public.profiles
where role is distinct from 'admin';

grant select on public.public_profiles to anon, authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  icon text,
  created_at timestamptz not null default now()
);

insert into public.categories (name, slug, icon) values
  ('Electrician', 'electrician', '⚡'),
  ('Plumber', 'plumber', '🔧'),
  ('Carpenter', 'carpenter', '🪚'),
  ('Painter', 'painter', '🖌'),
  ('AC repair', 'ac-repair', '❄'),
  ('Appliance repair', 'appliance-repair', '⌁'),
  ('Cleaner', 'cleaner', '✦')
on conflict (slug) do nothing;

create table public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  category text not null,
  bio text,
  experience_years integer not null default 0 check (experience_years between 0 and 70),
  cnic_verified boolean not null default false,
  is_active boolean not null default false,
  availability_status text not null default 'inactive'
    check (availability_status in ('active', 'busy', 'inactive')),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  service_radius_km numeric(6, 2) not null default 10 check (service_radius_km > 0),
  phone_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_active_status_consistent
    check (is_active = (availability_status in ('active', 'busy')))
);

create index provider_profiles_category_active_idx
  on public.provider_profiles (category, is_active);

create trigger provider_profiles_updated_at
before update on public.provider_profiles
for each row execute function public.set_updated_at();

create or replace function public.protect_provider_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_serviceconnect_admin() then
    if tg_op = 'INSERT' then
      if new.cnic_verified then
        raise exception 'Only an administrator can verify a provider';
      end if;
    elsif auth.uid() = old.profile_id then
      if new.profile_id is distinct from old.profile_id
        or new.cnic_verified is distinct from old.cnic_verified then
        raise exception 'Only an administrator can change provider verification';
      end if;
    elsif not public.is_serviceconnect_admin() then
      raise exception 'You cannot update another provider profile';
    end if;
  end if;
  return new;
end;
$$;

create trigger provider_profiles_protect_verification
before insert or update on public.provider_profiles
for each row execute function public.protect_provider_verification();

create table public.provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles (id) on delete cascade,
  task_name text not null check (length(trim(task_name)) between 1 and 120),
  price numeric(12, 2) not null check (price > 0),
  is_starting_from boolean not null default false,
  is_negotiable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index provider_services_provider_idx on public.provider_services (provider_id);

create trigger provider_services_updated_at
before update on public.provider_services
for each row execute function public.set_updated_at();

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null,
  address text not null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  working_hours jsonb not null default '{}'::jsonb,
  logo_url text,
  cover_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_category_active_idx on public.businesses (category, is_active);

create trigger businesses_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

create table public.business_providers (
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider_id uuid not null references public.provider_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, provider_id)
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references public.profiles (id) on delete cascade,
  participant_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chats_distinct_participants check (participant_a < participant_b),
  constraint chats_unique_pair unique (participant_a, participant_b)
);

create index chats_participant_a_idx on public.chats (participant_a, updated_at desc);
create index chats_participant_b_idx on public.chats (participant_b, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  content text check (content is null or length(content) <= 5000),
  image_url text,
  created_at timestamptz not null default now(),
  constraint messages_content_or_image check (
    nullif(trim(content), '') is not null or image_url is not null
  )
);

create index messages_chat_created_idx on public.messages (chat_id, created_at);

create or replace function public.touch_chat_on_message()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.chats set updated_at = new.created_at where id = new.chat_id;
  return new;
end;
$$;

create trigger messages_touch_chat
after insert on public.messages
for each row execute function public.touch_chat_on_message();

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references public.profiles (id) on delete cascade,
  to_profile_id uuid not null references public.profiles (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1500),
  created_at timestamptz not null default now(),
  constraint reviews_no_self_rating check (from_profile_id <> to_profile_id),
  constraint reviews_one_per_direction unique (from_profile_id, to_profile_id)
);

create index reviews_target_created_idx on public.reviews (to_profile_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_profile_id uuid references public.profiles (id) on delete set null,
  review_id uuid references public.reviews (id) on delete set null,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_target_required check (reported_profile_id is not null or review_id is not null)
);

create index reports_status_created_idx on public.reports (status, created_at desc);

create trigger reports_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create or replace function public.get_or_create_chat(other_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
  first_participant uuid;
  second_participant uuid;
  resolved_chat_id uuid;
begin
  if current_profile_id is null or other_profile_id is null
    or current_profile_id = other_profile_id then
    raise exception 'A valid other participant is required';
  end if;
  if not exists (select 1 from public.profiles where id = other_profile_id) then
    raise exception 'The requested profile does not exist';
  end if;
  first_participant := least(current_profile_id, other_profile_id);
  second_participant := greatest(current_profile_id, other_profile_id);
  insert into public.chats (participant_a, participant_b)
  values (first_participant, second_participant)
  on conflict (participant_a, participant_b) do update set updated_at = now()
  returning id into resolved_chat_id;
  return resolved_chat_id;
end;
$$;

create or replace function public.get_public_provider_phone(target_provider_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profiles.phone
  from public.provider_profiles providers
  join public.profiles profiles on profiles.id = providers.profile_id
  where providers.id = target_provider_profile_id
    and providers.is_active
    and providers.phone_public
    and auth.uid() is not null;
$$;

revoke all on function public.get_or_create_chat(uuid) from public;
grant execute on function public.get_or_create_chat(uuid) to authenticated;
revoke all on function public.get_public_provider_phone(uuid) from public;
grant execute on function public.get_public_provider_phone(uuid) to authenticated;
revoke all on function public.is_serviceconnect_admin() from public;
grant execute on function public.is_serviceconnect_admin() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.provider_profiles enable row level security;
alter table public.provider_services enable row level security;
alter table public.businesses enable row level security;
alter table public.business_providers enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
with check (id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Anyone can read categories"
on public.categories for select to anon, authenticated
using (true);

create policy "Admins can manage categories"
on public.categories for all to authenticated
using ((select public.is_serviceconnect_admin()))
with check ((select public.is_serviceconnect_admin()));

create policy "Active providers and owners can read provider profiles"
on public.provider_profiles for select to anon, authenticated
using (is_active or profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Users can create their provider profile"
on public.provider_profiles for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'provider'
  )
);

create policy "Owners and admins can update provider profiles"
on public.provider_profiles for update to authenticated
using (profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
with check (profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Owners and admins can delete provider profiles"
on public.provider_profiles for delete to authenticated
using (profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Visible provider services can be read"
on public.provider_services for select to anon, authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id
      and (
        providers.is_active
        or providers.profile_id = (select auth.uid())
        or (select public.is_serviceconnect_admin())
      )
  )
);

create policy "Provider owners can add services"
on public.provider_services for insert to authenticated
with check (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id and providers.profile_id = (select auth.uid())
  )
);

create policy "Provider owners can update services"
on public.provider_services for update to authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id
      and (providers.profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
  )
)
with check (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id
      and (providers.profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
  )
);

create policy "Provider owners can delete services"
on public.provider_services for delete to authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id
      and (providers.profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
  )
);

create policy "Active businesses and owners can read listings"
on public.businesses for select to anon, authenticated
using (is_active or owner_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Owners can create business listings"
on public.businesses for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'business_owner'
  )
);

create policy "Owners and admins can update business listings"
on public.businesses for update to authenticated
using (owner_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
with check (owner_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Owners and admins can delete business listings"
on public.businesses for delete to authenticated
using (owner_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Anyone can read active business links"
on public.business_providers for select to anon, authenticated
using (
  exists (
    select 1 from public.businesses business
    where business.id = business_id
      and (business.is_active or business.owner_id = (select auth.uid()))
  )
);

create policy "Business or provider owners can link providers"
on public.business_providers for insert to authenticated
with check (
  exists (
    select 1 from public.businesses business
    where business.id = business_id
      and business.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.provider_profiles provider
    where provider.id = provider_id
      and provider.profile_id = (select auth.uid())
  )
);

create policy "Business or provider owners can unlink providers"
on public.business_providers for delete to authenticated
using (
  exists (
    select 1 from public.businesses business
    where business.id = business_id
      and business.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.provider_profiles provider
    where provider.id = provider_id
      and provider.profile_id = (select auth.uid())
  )
);

create policy "Chat participants and admins can read chats"
on public.chats for select to authenticated
using (
  participant_a = (select auth.uid())
  or participant_b = (select auth.uid())
  or (select public.is_serviceconnect_admin())
);

create policy "Participants can read messages"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.chats conversation
    where conversation.id = chat_id
      and (
        conversation.participant_a = (select auth.uid())
        or conversation.participant_b = (select auth.uid())
        or (select public.is_serviceconnect_admin())
      )
  )
);

create policy "Chat participants can send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.chats conversation
    where conversation.id = chat_id
      and (
        (conversation.participant_a = sender_id and conversation.participant_b = receiver_id)
        or (conversation.participant_b = sender_id and conversation.participant_a = receiver_id)
      )
  )
);

create policy "Anyone can read reviews"
on public.reviews for select to anon, authenticated
using (true);

create policy "Chat participants can leave one review per direction"
on public.reviews for insert to authenticated
with check (
  from_profile_id = (select auth.uid())
  and exists (
    select 1 from public.chats conversation
    where (
      conversation.participant_a = from_profile_id and conversation.participant_b = to_profile_id
    ) or (
      conversation.participant_b = from_profile_id and conversation.participant_a = to_profile_id
    )
  )
);

create policy "Review authors and admins can update reviews"
on public.reviews for update to authenticated
using (from_profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
with check (
  (select public.is_serviceconnect_admin())
  or (
    from_profile_id = (select auth.uid())
    and exists (
      select 1 from public.chats conversation
      where (
        conversation.participant_a = from_profile_id and conversation.participant_b = to_profile_id
      ) or (
        conversation.participant_b = from_profile_id and conversation.participant_a = to_profile_id
      )
    )
  )
);

create policy "Review authors and admins can delete reviews"
on public.reviews for delete to authenticated
using (from_profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Users can create reports"
on public.reports for insert to authenticated
with check (reporter_id = (select auth.uid()));

create policy "Reporters and admins can read reports"
on public.reports for select to authenticated
using (reporter_id = (select auth.uid()) or (select public.is_serviceconnect_admin()));

create policy "Admins can moderate reports"
on public.reports for update to authenticated
using ((select public.is_serviceconnect_admin()))
with check ((select public.is_serviceconnect_admin()));

grant select, update on public.profiles to authenticated;
grant select on public.categories, public.provider_profiles, public.provider_services,
  public.businesses, public.business_providers, public.reviews to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.provider_profiles, public.provider_services,
  public.businesses, public.business_providers, public.reviews to authenticated;
grant select, insert on public.chats to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.reports to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('portfolio', 'portfolio', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('business-media', 'business-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('chat-media', 'chat-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Public can read public listing media"
on storage.objects for select to anon, authenticated
using (bucket_id in ('avatars', 'portfolio', 'business-media'));

create policy "Users can upload their own public listing media"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('avatars', 'portfolio', 'business-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can update their own public listing media"
on storage.objects for update to authenticated
using (
  bucket_id in ('avatars', 'portfolio', 'business-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id in ('avatars', 'portfolio', 'business-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their own public listing media"
on storage.objects for delete to authenticated
using (
  bucket_id in ('avatars', 'portfolio', 'business-media')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Chat participants can read shared chat media"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.messages message
      join public.chats conversation on conversation.id = message.chat_id
      where message.image_url = name
        and (
          conversation.participant_a = (select auth.uid())
          or conversation.participant_b = (select auth.uid())
        )
    )
  )
);

create policy "Users can upload their own chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their own chat media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
