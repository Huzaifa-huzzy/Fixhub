create table public.provider_contact_phones (
  provider_id uuid primary key references public.provider_profiles (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now()
);

alter table public.provider_contact_phones enable row level security;

create policy "Providers can manage their own contact phone"
on public.provider_contact_phones for all to authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id and providers.profile_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id and providers.profile_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.provider_contact_phones to authenticated;

create or replace function public.get_public_provider_phone(target_provider_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select contact_phones.phone
  from public.provider_profiles providers
  join public.provider_contact_phones contact_phones on contact_phones.provider_id = providers.id
  where providers.id = target_provider_profile_id
    and providers.is_active
    and providers.phone_public
    and auth.uid() is not null;
$$;

revoke all on function public.get_public_provider_phone(uuid) from public;
grant execute on function public.get_public_provider_phone(uuid) to authenticated;
