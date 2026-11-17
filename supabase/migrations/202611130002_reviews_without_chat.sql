create or replace function public.submit_provider_review(
  p_to_profile_id uuid,
  p_rating integer,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewer_profile_id uuid := auth.uid();
  created_review_id uuid;
begin
  if reviewer_profile_id is null then
    raise exception 'Sign in before submitting a review'
      using errcode = '42501';
  end if;

  if p_to_profile_id is null or p_to_profile_id = reviewer_profile_id then
    raise exception 'You cannot review your own profile'
      using errcode = '22023';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5'
      using errcode = '22023';
  end if;

  if p_comment is not null and length(p_comment) > 1500 then
    raise exception 'Review comments must be 1500 characters or fewer'
      using errcode = '22023';
  end if;

  insert into public.reviews (from_profile_id, to_profile_id, rating, comment)
  values (reviewer_profile_id, p_to_profile_id, p_rating, nullif(trim(p_comment), ''))
  returning id into created_review_id;

  return created_review_id;
end;
$$;

revoke all on function public.submit_provider_review(uuid, integer, text) from public;
grant execute on function public.submit_provider_review(uuid, integer, text) to authenticated;

drop policy if exists "Chat participants can leave one review per direction" on public.reviews;
create policy "Authenticated users can leave one review per direction"
on public.reviews for insert to authenticated
with check (
  from_profile_id = (select auth.uid())
  and from_profile_id <> to_profile_id
);

drop policy if exists "Review authors and admins can update reviews" on public.reviews;
create policy "Review authors and admins can update reviews"
on public.reviews for update to authenticated
using (from_profile_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
with check (
  (select public.is_serviceconnect_admin())
  or (
    from_profile_id = (select auth.uid())
    and from_profile_id <> to_profile_id
  )
);
