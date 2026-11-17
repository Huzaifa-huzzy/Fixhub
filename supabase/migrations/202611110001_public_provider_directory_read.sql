begin;

create or replace function public.map_providers(
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
  services jsonb
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
    coalesce(service_list.services, '[]'::jsonb)
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

create or replace function public.nearby_providers(
  latitude double precision,
  longitude double precision,
  radius_km double precision default 30,
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
  services jsonb
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
    coalesce(service_list.services, '[]'::jsonb)
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
    and radius_km > 0
    and radius_km <= 30
    and providers.lat between greatest(-90::double precision, latitude - radius_km / 110.574)
      and least(90::double precision, latitude + radius_km / 110.574)
    and (min_lat is null or providers.lat >= min_lat)
    and (max_lat is null or providers.lat <= max_lat)
    and (
      min_lng is null
      or max_lng is null
      or (min_lng <= max_lng and providers.lng between min_lng and max_lng)
      or (min_lng > max_lng and (providers.lng >= min_lng or providers.lng <= max_lng))
    )
    and distance.distance_km <= radius_km
  order by distance.distance_km, profiles.name;
$$;

revoke all on function public.nearby_providers(
  double precision, double precision, double precision,
  double precision, double precision, double precision, double precision
) from public;
grant execute on function public.nearby_providers(
  double precision, double precision, double precision,
  double precision, double precision, double precision, double precision
) to anon, authenticated;

create or replace function public.get_public_provider_profiles(target_profile_ids uuid[])
returns table (
  id uuid,
  name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profiles.id, profiles.name, profiles.avatar_url
  from public.profiles
  where profiles.id = any(coalesce(target_profile_ids, '{}'::uuid[]))
    and profiles.role = 'provider'
    and exists (
      select 1
      from public.provider_profiles providers
      where providers.profile_id = profiles.id
        and (
          providers.verification_status = 'verified'
          or providers.profile_id = (select auth.uid())
          or (select public.is_serviceconnect_admin())
        )
    );
$$;

revoke all on function public.get_public_provider_profiles(uuid[]) from public;
grant execute on function public.get_public_provider_profiles(uuid[]) to anon, authenticated;

commit;
