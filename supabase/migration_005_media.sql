-- =====================================================================
-- Migration 005: photos + voice messages (private Storage bucket)
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- =====================================================================

-- 1) Message columns
alter table public.messages add column if not exists type text not null default 'text';
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check check (type in ('text', 'image', 'voice'));
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_duration int;

-- Senders may only attach files from their own folder
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and status = 'sent'
              and public.is_approved() and public.is_approved(receiver_id)
              and public.are_paired(sender_id, receiver_id)
              and ((type = 'text' and media_path is null)
                   or (type in ('image', 'voice') and split_part(media_path, '/', 1) = auth.uid()::text)));

-- 2) Private bucket: 10 MB max, images + audio only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'];

-- 3) Who can read a file: its uploader, or a paired participant of a message that references it
create or replace function public.can_read_media(p text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.messages m
    where m.media_path = p and public.is_approved()
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
      and public.are_paired(m.sender_id, m.receiver_id));
$$;
revoke execute on function public.can_read_media(text) from public, anon;
grant  execute on function public.can_read_media(text) to authenticated;

drop policy if exists "chat media upload" on storage.objects;
create policy "chat media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved());

drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-media'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.can_read_media(name)));

drop policy if exists "chat media delete own" on storage.objects;
create policy "chat media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);
