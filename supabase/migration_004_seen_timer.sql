-- =====================================================================
-- Migration 004: messages disappear 5 minutes after they are SEEN
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- =====================================================================

alter table public.messages add column if not exists seen_at timestamptz;

-- Server-side stamp: seen_at is set by the database (not the client) the moment status becomes 'seen'.
create or replace function public.stamp_seen_at() returns trigger
language plpgsql as $$
begin
  if old.status = 'seen' then            -- 'seen' is final; the timer never restarts
    new.status  := 'seen';
    new.seen_at := old.seen_at;
  elsif new.status = 'seen' then
    new.seen_at := now();
  else
    new.seen_at := old.seen_at;
  end if;
  return new;
end $$;

drop trigger if exists messages_stamp_seen on public.messages;
create trigger messages_stamp_seen before update on public.messages
  for each row execute function public.stamp_seen_at();

-- Messages already marked seen before this migration: treat them as seen when they were sent (they expire now)
update public.messages set seen_at = "timestamp" where status = 'seen' and seen_at is null;
