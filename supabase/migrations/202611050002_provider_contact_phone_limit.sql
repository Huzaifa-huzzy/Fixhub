alter table public.provider_contact_phones
  add column slot smallint not null default 1 check (slot between 1 and 2);

alter table public.provider_contact_phones
  drop constraint provider_contact_phones_pkey,
  add constraint provider_contact_phones_pkey primary key (provider_id, slot),
  add constraint provider_contact_phones_provider_phone_key unique (provider_id, phone);

create or replace function public.get_public_provider_phones(target_provider_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select array_agg(contact_phones.phone order by contact_phones.slot)
  from public.provider_profiles providers
  join public.provider_contact_phones contact_phones on contact_phones.provider_id = providers.id
  where providers.id = target_provider_profile_id
    and providers.is_active
    and providers.phone_public
    and auth.uid() is not null;
$$;

revoke all on function public.get_public_provider_phones(uuid) from public;
grant execute on function public.get_public_provider_phones(uuid) to authenticated;
