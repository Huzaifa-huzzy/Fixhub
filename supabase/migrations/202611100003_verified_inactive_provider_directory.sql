begin;

drop policy if exists "Verified active providers and owners can read provider profiles"
on public.provider_profiles;
drop policy if exists "Verified providers and owners can read provider profiles"
on public.provider_profiles;

create policy "Verified providers and owners can read provider profiles"
on public.provider_profiles for select to anon, authenticated
using (
  (verification_status = 'verified')
  or profile_id = (select auth.uid())
  or (select public.is_serviceconnect_admin())
);

drop policy if exists "Verified provider services and owners can be read"
on public.provider_services;
drop policy if exists "Verified provider services and owners can read"
on public.provider_services;

create policy "Verified provider services and owners can read"
on public.provider_services for select to anon, authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_id
      and (
        providers.verification_status = 'verified'
        or providers.profile_id = (select auth.uid())
        or (select public.is_serviceconnect_admin())
      )
  )
);

commit;
