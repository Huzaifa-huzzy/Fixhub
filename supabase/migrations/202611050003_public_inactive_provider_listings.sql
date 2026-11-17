drop policy if exists "Active providers and owners can read provider profiles"
on public.provider_profiles;

create policy "Public can read provider profiles"
on public.provider_profiles for select to anon, authenticated
using (true);

drop policy if exists "Visible provider services can be read"
on public.provider_services;

create policy "Public can read provider services"
on public.provider_services for select to anon, authenticated
using (
  exists (
    select 1 from public.provider_profiles providers
    where providers.id = provider_services.provider_id
  )
);
