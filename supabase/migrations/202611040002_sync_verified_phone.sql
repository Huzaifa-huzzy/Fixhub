create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if auth.uid() = old.id then
      if new.phone is distinct from old.phone
        and not exists (
          select 1
          from auth.users auth_user
          where auth_user.id = old.id
            and auth_user.phone is not distinct from new.phone
        ) then
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

create or replace function public.sync_verified_auth_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set phone = new.phone
  where id = new.id
    and phone is distinct from new.phone;
  return new;
end;
$$;

create trigger on_auth_user_phone_updated
after update of phone on auth.users
for each row
when (old.phone is distinct from new.phone)
execute function public.sync_verified_auth_phone();
