-- =====================================================================
-- Migration 006: reply, edit, delete-for-everyone, emoji reactions
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- =====================================================================

alter table public.messages add column if not exists reply_to   uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at  timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

-- Content may be emptied when a message is deleted
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_content_len;
alter table public.messages add constraint messages_content_len check (char_length(content) <= 2000);

-- A reply must point to a message of the SAME conversation
create or replace function public.reply_ok(reply uuid, s uuid, r uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select reply is null or exists (
    select 1 from public.messages m
    where m.id = reply and ((m.sender_id = s and m.receiver_id = r) or (m.sender_id = r and m.receiver_id = s)));
$$;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and status = 'sent' and seen_at is null
              and deleted_at is null and edited_at is null
              and public.is_approved() and public.is_approved(receiver_id)
              and public.are_paired(sender_id, receiver_id)
              and public.reply_ok(reply_to, sender_id, receiver_id)
              and ((type = 'text' and media_path is null and char_length(content) between 1 and 2000)
                   or (type in ('image', 'voice') and split_part(media_path, '/', 1) = auth.uid()::text)));

-- Senders may edit / delete their own messages; the guard trigger limits WHAT may change
grant update (status, content, edited_at, deleted_at, media_path) on public.messages to authenticated;
drop policy if exists messages_sender_update on public.messages;
create policy messages_sender_update on public.messages for update to authenticated
  using      (public.is_approved() and sender_id = auth.uid() and public.are_paired(sender_id, receiver_id))
  with check (public.is_approved() and sender_id = auth.uid() and public.are_paired(sender_id, receiver_id));

create or replace function public.guard_message_update() returns trigger
language plpgsql as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;   -- service role / SQL editor

  if new.id is distinct from old.id or new.sender_id is distinct from old.sender_id
     or new.receiver_id is distinct from old.receiver_id or new."timestamp" is distinct from old."timestamp"
     or new.type is distinct from old.type or new.reply_to is distinct from old.reply_to
     or new.media_duration is distinct from old.media_duration or new.hidden is distinct from old.hidden then
    raise exception 'These message fields cannot be changed.';
  end if;

  if uid = old.receiver_id then               -- recipient: may only mark as seen
    if new.content is distinct from old.content or new.media_path is distinct from old.media_path
       or new.edited_at is distinct from old.edited_at or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Recipients can only mark messages as seen.';
    end if;
    return new;
  elsif uid = old.sender_id then              -- sender: may edit text or delete for everyone
    if new.status is distinct from old.status or new.seen_at is distinct from old.seen_at then
      raise exception 'Only the recipient can change the seen status.';
    end if;
    if old.deleted_at is not null then raise exception 'This message was already deleted.'; end if;
    if new.deleted_at is not null then        -- delete for everyone
      new.deleted_at := now(); new.content := ''; new.media_path := null; new.edited_at := old.edited_at;
      return new;
    end if;
    if new.media_path is distinct from old.media_path then raise exception 'Attachments cannot be changed.'; end if;
    if new.content is distinct from old.content then
      if old.type <> 'text' then raise exception 'Only text messages can be edited.'; end if;
      if now() - old."timestamp" > interval '15 minutes' then raise exception 'Messages can only be edited for 15 minutes.'; end if;
      if char_length(new.content) not between 1 and 2000 then raise exception 'Message length must be 1-2000 characters.'; end if;
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
    return new;
  end if;
  raise exception 'Not allowed.';
end $$;

drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update before update on public.messages   -- fires before messages_stamp_seen (alphabetical)
  for each row execute function public.guard_message_update();

-- Reactions: one emoji per person per message ('' = removed; clients never DELETE, so realtime stays RLS-filtered)
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  emoji      text not null default '' check (char_length(emoji) <= 16),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;

create or replace function public.can_see_message(mid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.messages m
    where m.id = mid and public.is_approved()
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
      and public.are_paired(m.sender_id, m.receiver_id));
$$;
revoke execute on function public.can_see_message(uuid) from public, anon;
grant  execute on function public.can_see_message(uuid) to authenticated;

drop policy if exists reactions_select on public.message_reactions;
create policy reactions_select on public.message_reactions for select to authenticated
  using (public.can_see_message(message_id));
drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_message(message_id));
drop policy if exists reactions_update on public.message_reactions;
create policy reactions_update on public.message_reactions for update to authenticated
  using (user_id = auth.uid() and public.can_see_message(message_id))
  with check (user_id = auth.uid() and public.can_see_message(message_id));

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
