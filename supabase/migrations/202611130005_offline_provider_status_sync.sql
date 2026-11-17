begin;

alter table public.provider_profiles
  add column last_seen_at timestamptz,
  add column location_updated_at timestamptz;

create or replace function public.track_provider_location_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.lat is not null and new.lng is not null then
      new.location_updated_at := coalesce(new.location_updated_at, now());
    end if;
  elsif new.lat is distinct from old.lat or new.lng is distinct from old.lng then
    new.location_updated_at := case
      when new.lat is not null and new.lng is not null then now()
      else null
    end;
  end if;
  return new;
end;
$$;

create trigger provider_profiles_track_location
before insert or update of lat, lng on public.provider_profiles
for each row execute function public.track_provider_location_update();

create or replace function public.sync_provider_availability(
  target_provider_profile_id uuid,
  target_availability_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expected_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if target_availability_status is null
    or target_availability_status not in ('active', 'busy', 'inactive') then
    raise exception 'Invalid provider availability status';
  end if;
  expected_active := target_availability_status in ('active', 'busy');

  update public.provider_profiles
  set availability_status = target_availability_status,
    is_active = expected_active,
    last_seen_at = now()
  where id = target_provider_profile_id
    and profile_id = auth.uid()
    and (not expected_active or verification_status = 'verified')
    and (
      availability_status is distinct from target_availability_status
      or is_active is distinct from expected_active
    );

  if not found then
    if exists (
      select 1
      from public.provider_profiles
      where id = target_provider_profile_id
        and profile_id = auth.uid()
        and expected_active
        and verification_status <> 'verified'
    ) then
      raise exception 'Provider verification is required to appear as available';
    end if;

    if not exists (
      select 1
      from public.provider_profiles
      where id = target_provider_profile_id
        and profile_id = auth.uid()
    ) then
      raise exception 'Provider profile not found';
    end if;
  end if;
end;
$$;

create or replace function public.record_provider_presence(target_provider_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  update public.provider_profiles
  set last_seen_at = now()
  where id = target_provider_profile_id
    and profile_id = auth.uid()
    and verification_status = 'verified';

  if not found then
    raise exception 'Verified provider profile not found';
  end if;
end;
$$;

revoke all on function public.sync_provider_availability(uuid, text) from public;
revoke all on function public.sync_provider_availability(uuid, text) from anon, service_role;
grant execute on function public.sync_provider_availability(uuid, text) to authenticated;
revoke all on function public.record_provider_presence(uuid) from public;
revoke all on function public.record_provider_presence(uuid) from anon, service_role;
grant execute on function public.record_provider_presence(uuid) to authenticated;

drop function public.map_providers(
  double precision, double precision,
  double precision, double precision, double precision, double precision
);

create function public.map_providers(
  latitude double precision,
  longitude double precision,
  min_lat double precision default null,
  max_lat double precision default null,
  min_lng double precision default null,
  max_lng double precision default null
)
returns table (
  provider_profile_id uuid,
  profile_id uuid,
  name text,
  avatar_url text,
  category text,
  bio text,
  experience_years integer,
  availability_status text,
  provider_lat double precision,
  provider_lng double precision,
  distance_km double precision,
  average_rating double precision,
  review_count bigint,
  services jsonb,
  is_online boolean,
  last_seen_at timestamptz,
  location_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    providers.id,
    providers.profile_id,
    profiles.name,
    profiles.avatar_url,
    providers.category,
    providers.bio,
    providers.experience_years,
    providers.availability_status,
    providers.lat,
    providers.lng,
    distance.distance_km,
    coalesce(ratings.average_rating, 0)::double precision,
    coalesce(ratings.review_count, 0),
    coalesce(service_list.services, '[]'::jsonb),
    providers.last_seen_at is not null
      and providers.last_seen_at >= now() - interval '3 minutes',
    providers.last_seen_at,
    providers.location_updated_at
  from public.provider_profiles providers
  join public.profiles profiles
    on profiles.id = providers.profile_id
    and profiles.role = 'provider'
  cross join lateral (
    select 6371 * 2 * asin(sqrt(least(1::double precision, greatest(0::double precision,
      sin(radians(providers.lat - latitude) / 2) ^ 2
      + cos(radians(latitude)) * cos(radians(providers.lat))
      * sin(radians(providers.lng - longitude) / 2) ^ 2
    )))) as distance_km
  ) distance
  left join lateral (
    select
      avg(reviews.rating)::double precision as average_rating,
      count(*) as review_count
    from public.reviews
    where reviews.to_profile_id = providers.profile_id
  ) ratings on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'name', provider_services.task_name,
      'price', provider_services.price,
      'startingFrom', provider_services.is_starting_from,
      'negotiable', provider_services.is_negotiable
    ) order by provider_services.created_at, provider_services.id) as services
    from public.provider_services
    where provider_services.provider_id = providers.id
  ) service_list on true
  where providers.is_active
    and providers.verification_status = 'verified'
    and providers.lat is not null
    and providers.lng is not null
    and (min_lat is null or providers.lat >= min_lat)
    and (max_lat is null or providers.lat <= max_lat)
    and (
      min_lng is null
      or max_lng is null
      or (min_lng <= max_lng and providers.lng between min_lng and max_lng)
      or (min_lng > max_lng and (providers.lng >= min_lng or providers.lng <= max_lng))
    )
  order by distance.distance_km, profiles.name;
$$;

revoke all on function public.map_providers(
  double precision, double precision,
  double precision, double precision, double precision, double precision
) from public;
grant execute on function public.map_providers(
  double precision, double precision,
  double precision, double precision, double precision, double precision
) to anon, authenticated;

commit;
