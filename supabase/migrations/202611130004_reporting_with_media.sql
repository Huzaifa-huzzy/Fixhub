alter table public.reports
  add column title text not null default 'Legacy report',
  add column category text not null default 'Other',
  add column submitted boolean not null default true;

alter table public.reports
  alter column submitted set default false,
  drop constraint if exists reports_target_required,
  add constraint reports_title_length_check
    check (length(trim(title)) between 1 and 160),
  add constraint reports_category_length_check
    check (length(trim(category)) between 1 and 80);

create index reports_submitted_status_created_idx
  on public.reports (submitted, status, created_at desc);

alter table public.reports
  add constraint reports_id_reporter_id_unique unique (id, reporter_id);

drop policy if exists "Users can create reports" on public.reports;
create policy "Users can create report drafts"
on public.reports for insert to authenticated
with check (reporter_id = (select auth.uid()) and not submitted);

drop policy if exists "Reporters and admins can read reports" on public.reports;
create policy "Reporters and admins can read submitted reports"
on public.reports for select to authenticated
using (
  submitted
  and (reporter_id = (select auth.uid()) or (select public.is_serviceconnect_admin()))
);

create table public.report_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  storage_path text not null unique,
  content_type text not null,
  file_size bigint not null check (file_size > 0),
  uploaded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint report_attachments_report_owner_fk
    foreign key (report_id, reporter_id)
    references public.reports (id, reporter_id) on delete cascade,
  constraint report_attachments_path_shape_check
    check (storage_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'),
  constraint report_attachments_media_check
    check (
      (
        kind = 'image'
        and content_type in ('image/jpeg', 'image/png', 'image/webp')
        and file_size <= 5242880
        and lower(storage_path) ~ '\.(jpg|jpeg|png|webp)$'
      )
      or (
        kind = 'video'
        and content_type in ('video/mp4', 'video/quicktime', 'video/webm')
        and file_size <= 26214400
        and lower(storage_path) ~ '\.(mp4|mov|webm)$'
      )
    )
);

create index report_attachments_report_idx
  on public.report_attachments (report_id, created_at);

create or replace function public.create_report_draft(
  target_title text,
  target_description text,
  target_category text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
  created_report_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Authentication is required';
  end if;

  if length(trim(coalesce(target_title, ''))) not between 1 and 160 then
    raise exception 'Report title must be between 1 and 160 characters';
  end if;

  if length(trim(coalesce(target_description, ''))) not between 1 and 1000 then
    raise exception 'Report description must be between 1 and 1000 characters';
  end if;

  if length(trim(coalesce(target_category, ''))) not between 1 and 80 then
    raise exception 'Report category is required';
  end if;

  insert into public.reports (
    reporter_id,
    title,
    reason,
    category,
    submitted
  )
  values (
    current_profile_id,
    trim(target_title),
    trim(target_description),
    trim(target_category),
    false
  )
  returning id into created_report_id;

  return created_report_id;
end;
$$;

create or replace function public.guard_report_attachment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  report_reporter_id uuid;
  existing_count integer;
begin
  select reporter_id
  into report_reporter_id
  from public.reports
  where id = new.report_id
    and reporter_id = new.reporter_id
    and not submitted
  for update;

  if not found then
    raise exception 'Report is unavailable for attachments';
  end if;

  if auth.uid() is not null and auth.uid() <> new.reporter_id then
    raise exception 'You can only attach media to your own report';
  end if;

  if new.storage_path not like new.reporter_id::text || '/' || new.report_id::text || '/%' then
    raise exception 'Invalid report media path';
  end if;

  select count(*)
  into existing_count
  from public.report_attachments
  where report_id = new.report_id
    and kind = new.kind;

  if new.kind = 'image' and existing_count >= 2 then
    raise exception 'A report can have at most 2 images';
  elsif new.kind = 'video' and existing_count >= 1 then
    raise exception 'A report can have at most 1 video';
  end if;

  if new.uploaded then
    raise exception 'Report media must be uploaded before it can be finalized';
  end if;

  return new;
end;
$$;

create trigger report_attachments_guard
before insert on public.report_attachments
for each row execute function public.guard_report_attachment();

alter table public.report_attachments enable row level security;

create policy "Reporters and admins can read submitted report media"
on public.report_attachments for select to authenticated
using (
  uploaded
  and exists (
    select 1
    from public.reports
    where reports.id = report_id
      and reports.submitted
      and (
        reports.reporter_id = (select auth.uid())
        or (select public.is_serviceconnect_admin())
      )
  )
);

create policy "Reporters can reserve their own report media"
on public.report_attachments for insert to authenticated
with check (
  reporter_id = (select auth.uid())
  and not uploaded
);

grant select, insert on public.report_attachments to authenticated;

create or replace function public.can_upload_report_evidence(
  target_path text,
  target_metadata jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
  allowed_size bigint;
  reserved_size bigint;
  reserved_type text;
  actual_size bigint;
begin
  if current_profile_id is null then
    return false;
  end if;

  begin
    actual_size := nullif(target_metadata->>'size', '')::bigint;
  exception when invalid_text_representation then
    return false;
  end;

  select attachments.file_size, attachments.content_type
  into reserved_size, reserved_type
  from public.report_attachments attachments
  join public.reports on reports.id = attachments.report_id
  where attachments.storage_path = target_path
    and attachments.reporter_id = current_profile_id
    and not attachments.uploaded
    and not reports.submitted;

  if not found or actual_size is null or reserved_size <> actual_size
    or reserved_type <> target_metadata->>'mimetype' then
    return false;
  end if;

  allowed_size := case
    when reserved_type like 'image/%' then 5242880
    when reserved_type like 'video/%' then 26214400
    else 0
  end;

  return actual_size > 0 and actual_size <= allowed_size;
end;
$$;

create or replace function public.can_delete_report_draft_evidence(target_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.report_attachments attachments
    join public.reports on reports.id = attachments.report_id
    where attachments.storage_path = target_path
      and attachments.reporter_id = (select auth.uid())
      and not attachments.uploaded
      and not reports.submitted
  );
$$;

revoke all on function public.can_upload_report_evidence(text, jsonb) from public;
grant execute on function public.can_upload_report_evidence(text, jsonb) to authenticated;
revoke all on function public.can_delete_report_draft_evidence(text) from public;
grant execute on function public.can_delete_report_draft_evidence(text) to authenticated;

create or replace function public.finalize_report_submission(target_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Authentication is required';
  end if;

  perform 1
  from public.reports
  where id = target_report_id
    and reporter_id = current_profile_id
    and not submitted
  for update;

  if not found then
    raise exception 'Report is unavailable for submission';
  end if;

  if exists (
    select 1
    from public.report_attachments attachments
    where attachments.report_id = target_report_id
      and not exists (
        select 1
        from storage.objects objects
        where objects.bucket_id = 'report-evidence'
          and objects.name = attachments.storage_path
      )
  ) then
    raise exception 'One or more report attachments have not uploaded';
  end if;

  update public.report_attachments
  set uploaded = true
  where report_id = target_report_id;

  update public.reports
  set submitted = true
  where id = target_report_id;
end;
$$;

create or replace function public.discard_report_submission(target_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Authentication is required';
  end if;

  delete from public.reports
  where id = target_report_id
    and reporter_id = current_profile_id
    and not submitted;

  if not found then
    raise exception 'Unable to discard this report';
  end if;
end;
$$;

revoke all on function public.finalize_report_submission(uuid) from public;
grant execute on function public.finalize_report_submission(uuid) to authenticated;
revoke all on function public.discard_report_submission(uuid) from public;
grant execute on function public.discard_report_submission(uuid) to authenticated;
revoke all on function public.create_report_draft(text, text, text) from public;
grant execute on function public.create_report_draft(text, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-evidence',
  'report-evidence',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Reporters and admins can read submitted report evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'report-evidence'
  and exists (
    select 1
    from public.report_attachments attachments
    join public.reports on reports.id = attachments.report_id
    where attachments.storage_path = name
      and attachments.uploaded
      and reports.submitted
      and (
        reports.reporter_id = (select auth.uid())
        or (select public.is_serviceconnect_admin())
      )
  )
);

create policy "Reporters can upload reserved report evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'report-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.can_upload_report_evidence(name, metadata))
);

create policy "Reporters can remove evidence from report drafts"
on storage.objects for delete to authenticated
using (
  bucket_id = 'report-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.can_delete_report_draft_evidence(name))
);
