begin;

alter table public.provider_profiles
  add column if not exists cnic_selfie_url text;

alter table public.provider_profiles
  drop constraint if exists provider_profiles_cnic_document_paths,
  add constraint provider_profiles_cnic_document_paths
    check (
      (cnic_front_url is null or cnic_front_url like profile_id::text || '/%')
      and (cnic_back_url is null or cnic_back_url like profile_id::text || '/%')
      and (cnic_selfie_url is null or cnic_selfie_url like profile_id::text || '/%')
    ),
  drop constraint if exists provider_profiles_verified_has_cnic,
  add constraint provider_profiles_verified_has_cnic
    check (
      verification_status <> 'verified'
      or (
        cnic_number is not null
        and cnic_front_url is not null
        and cnic_back_url is not null
        and cnic_selfie_url is not null
      )
    );

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
      raise exception 'A provider must submit CNIC details and a selfie before approval';
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
      raise exception 'Submit your CNIC number, both document photos, and a selfie';
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

drop function if exists public.get_provider_verification(uuid);
create function public.get_provider_verification(p_profile_id uuid default null)
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

drop function if exists public.get_pending_provider_verifications();
create function public.get_pending_provider_verifications()
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

commit;
