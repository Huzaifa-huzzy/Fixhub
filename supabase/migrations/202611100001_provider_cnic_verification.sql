create type public.provider_verification_status as enum ('pending', 'verified', 'rejected');

alter table public.provider_profiles
  add column verification_status public.provider_verification_status not null default 'pending',
  add column cnic_number text,
  add column cnic_front_url text,
  add column cnic_back_url text,
  add column cnic_selfie_url text,
  add column rejection_reason text;

update public.provider_profiles
set verification_status = 'pending',
  cnic_verified = false;

update public.provider_profiles
set is_active = false,
  availability_status = 'inactive'
where verification_status <> 'verified'
  and (is_active or availability_status <> 'inactive');

alter table public.provider_profiles
  add constraint provider_profiles_cnic_number_format
    check (cnic_number is null or cnic_number ~ '^[0-9]{13}$'),
  add constraint provider_profiles_cnic_document_paths
    check (
      (cnic_front_url is null or cnic_front_url like profile_id::text || '/%')
      and (cnic_back_url is null or cnic_back_url like profile_id::text || '/%')
      and (cnic_selfie_url is null or cnic_selfie_url like profile_id::text || '/%')
    ),
  add constraint provider_profiles_verified_has_cnic
    check (
      verification_status <> 'verified'
      or (
        cnic_number is not null
        and cnic_front_url is not null
        and cnic_back_url is not null
        and cnic_selfie_url is not null
      )
    ),
  add constraint provider_profiles_availability_requires_verification
    check (
      verification_status = 'verified'
      or (not is_active and availability_status = 'inactive')
    );

create index provider_profiles_verification_status_idx
  on public.provider_profiles (verification_status, updated_at);

drop trigger if exists provider_profiles_protect_verification on public.provider_profiles;

create or replace function public.protect_provider_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_serviceconnect_admin() then
    if new.verification_status = 'rejected'
      and nullif(trim(new.rejection_reason), '') is null then
      raise exception 'A reason is required when rejecting a provider';
    end if;
    if new.verification_status = 'verified'
      and (
        new.cnic_number is null
        or new.cnic_front_url is null
        or new.cnic_back_url is null
        or new.cnic_selfie_url is null
      ) then
      raise exception 'A provider must submit CNIC details before approval';
    end if;
    new.cnic_verified := new.verification_status = 'verified';
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    new.cnic_verified := false;
    new.rejection_reason := null;
  else
    if auth.uid() <> old.profile_id then
      raise exception 'You cannot update another provider profile';
    end if;
    if new.profile_id is distinct from old.profile_id
      or new.cnic_verified is distinct from old.cnic_verified then
      raise exception 'Only an administrator can change provider verification';
    end if;
    if new.verification_status is distinct from old.verification_status
      and new.verification_status <> 'pending' then
      raise exception 'Only an administrator can approve or reject a provider';
    end if;
    if (
      new.cnic_number is distinct from old.cnic_number
      or new.cnic_front_url is distinct from old.cnic_front_url
      or new.cnic_back_url is distinct from old.cnic_back_url
      or new.cnic_selfie_url is distinct from old.cnic_selfie_url
    ) and new.verification_status <> 'pending' then
      raise exception 'CNIC documents must be submitted for review';
    end if;
    if new.verification_status = 'pending'
      and (
        new.verification_status is distinct from old.verification_status
        or new.cnic_number is distinct from old.cnic_number
        or new.cnic_front_url is distinct from old.cnic_front_url
        or new.cnic_back_url is distinct from old.cnic_back_url
        or new.cnic_selfie_url is distinct from old.cnic_selfie_url
      )
      and (
        new.cnic_number is null
        or new.cnic_front_url is null
        or new.cnic_back_url is null
        or new.cnic_selfie_url is null
      ) then
      raise exception 'Submit your CNIC number and both document photos';
    end if;
    if new.verification_status = 'pending'
      and old.verification_status = 'rejected' then
      new.rejection_reason := null;
    elsif new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Only an administrator can change the rejection reason';
    end if;
    new.cnic_verified := new.verification_status = 'verified';
  end if;

  return new;
end;
$$;

create trigger provider_profiles_protect_verification
before insert or update on public.provider_profiles
for each row execute function public.protect_provider_verification();

create table public.provider_push_tokens (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, expo_push_token),
  constraint provider_push_tokens_expo_format
    check (expo_push_token like 'ExponentPushToken[%]' or expo_push_token like 'ExpoPushToken[%]')
);

alter table public.provider_push_tokens enable row level security;
revoke all on public.provider_push_tokens from anon, authenticated;
grant select, insert, update, delete on public.provider_push_tokens to authenticated;

create policy "Providers can manage their own push tokens"
on public.provider_push_tokens for all to authenticated
using (profile_id = (select auth.uid()))
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'provider'
  )
);

drop policy if exists "Active providers and owners can read provider profiles"
on public.provider_profiles;
drop policy if exists "Public can read provider profiles"
on public.provider_profiles;

create policy "Verified active providers and owners can read provider profiles"
on public.provider_profiles for select to anon, authenticated
using (
  (is_active and verification_status = 'verified')
  or profile_id = (select auth.uid())
  or (select public.is_serviceconnect_admin())
);

drop policy if exists "Visible provider services can be read"
on public.provider_services;
drop policy if exists "Public can read provider services"
on public.provider_services;

create policy "Verified provider services and owners can be read"
on public.provider_services for select to anon, authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id
      and (
        (providers.is_active and providers.verification_status = 'verified')
        or providers.profile_id = (select auth.uid())
        or (select public.is_serviceconnect_admin())
      )
  )
);

revoke select on public.provider_profiles from anon, authenticated;
grant select (
  id,
  profile_id,
  category,
  bio,
  experience_years,
  cnic_verified,
  is_active,
  availability_status,
  lat,
  lng,
  service_radius_km,
  phone_public,
  created_at,
  updated_at,
  verification_status
) on public.provider_profiles to anon, authenticated;

create or replace function public.get_provider_verification(p_profile_id uuid default null)
returns table (
  provider_profile_id uuid,
  verification_status public.provider_verification_status,
  cnic_number text,
  cnic_front_url text,
  cnic_back_url text,
  cnic_selfie_url text,
  rejection_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_profile_id uuid := coalesce(p_profile_id, auth.uid());
begin
  if target_profile_id is null
    or (
      target_profile_id <> auth.uid()
      and not public.is_serviceconnect_admin()
    ) then
    raise exception 'You are not allowed to view these verification details';
  end if;

  return query
  select providers.id, providers.verification_status, providers.cnic_number,
    providers.cnic_front_url, providers.cnic_back_url, providers.cnic_selfie_url,
    providers.rejection_reason
  from public.provider_profiles providers
  where providers.profile_id = target_profile_id;
end;
$$;

create or replace function public.get_pending_provider_verifications()
returns table (
  profile_id uuid,
  provider_profile_id uuid,
  provider_name text,
  category text,
  verification_status public.provider_verification_status,
  cnic_number text,
  cnic_front_url text,
  cnic_back_url text,
  cnic_selfie_url text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_serviceconnect_admin() then
    raise exception 'Only administrators can review provider documents';
  end if;

  return query
  select providers.profile_id, providers.id, profiles.name, providers.category,
    providers.verification_status, providers.cnic_number,
    providers.cnic_front_url, providers.cnic_back_url, providers.cnic_selfie_url
  from public.provider_profiles providers
  join public.profiles profiles on profiles.id = providers.profile_id
  where providers.verification_status = 'pending'
    and providers.cnic_number is not null
    and providers.cnic_front_url is not null
    and providers.cnic_back_url is not null
    and providers.cnic_selfie_url is not null
  order by providers.updated_at;
end;
$$;

revoke all on function public.get_provider_verification(uuid) from public;
grant execute on function public.get_provider_verification(uuid) to authenticated;
revoke all on function public.get_pending_provider_verifications() from public;
grant execute on function public.get_pending_provider_verifications() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cnic-documents', 'cnic-documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners and admins can read CNIC documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'cnic-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_serviceconnect_admin())
  )
);

create policy "Owners can upload their own CNIC documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'cnic-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners can update their own CNIC documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'cnic-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'cnic-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Owners can delete their own CNIC documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'cnic-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
