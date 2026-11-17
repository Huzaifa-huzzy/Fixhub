alter table public.profiles
  add column username text,
  add constraint profiles_username_length
    check (username is null or char_length(btrim(username)) between 2 and 50);

create unique index profiles_username_unique
  on public.profiles (
    lower(regexp_replace(btrim(username), '[[:space:]]+', ' ', 'g'))
  )
  where username is not null;

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
      if new.username is distinct from old.username then
        raise exception 'Login name cannot be changed';
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

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, phone, name, username)
  values (
    new.id,
    new.phone,
    nullif(regexp_replace(btrim(new.raw_user_meta_data ->> 'name'), '[[:space:]]+', ' ', 'g'), ''),
    nullif(regexp_replace(btrim(new.raw_user_meta_data ->> 'username'), '[[:space:]]+', ' ', 'g'), '')
  )
  on conflict (id) do update set phone = excluded.phone;
  return new;
end;
$$;
