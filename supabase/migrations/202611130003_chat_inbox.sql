create or replace function public.list_my_chats()
returns table (
  chat_id uuid,
  other_profile_id uuid,
  other_profile_name text,
  other_profile_avatar_url text,
  updated_at timestamptz,
  last_message_preview text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Sign in to view your chats'
      using errcode = '42501';
  end if;

  return query
  select
    conversation.id,
    other_profile.id,
    other_profile.name,
    other_profile.avatar_url,
    coalesce(latest_message.created_at, conversation.updated_at),
    coalesce(nullif(trim(latest_message.content), ''), case when latest_message.image_url is not null then 'Photo' end)
  from public.chats conversation
  join public.profiles other_profile
    on other_profile.id = case
      when conversation.participant_a = current_profile_id then conversation.participant_b
      else conversation.participant_a
    end
  left join lateral (
    select message.content, message.image_url, message.created_at
    from public.messages message
    where message.chat_id = conversation.id
    order by message.created_at desc
    limit 1
  ) latest_message on true
  where conversation.participant_a = current_profile_id
    or conversation.participant_b = current_profile_id
  order by coalesce(latest_message.created_at, conversation.updated_at) desc;
end;
$$;

revoke all on function public.list_my_chats() from public;
grant execute on function public.list_my_chats() to authenticated;
