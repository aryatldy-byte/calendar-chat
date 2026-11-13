-- =====================================================================
-- Migration 008: "came online" alerts + clear chat support
-- Safe to run more than once. Run in Supabase → SQL Editor (after 002–007).
-- =====================================================================

-- 1) Each person can switch "tell me when they come online" notifications on/off (default on)
alter table public.users add column if not exists online_alerts boolean not null default true;

create or replace function public.set_online_alerts(enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved() then return; end if;
  update public.users set online_alerts = enabled where id = auth.uid();
end $$;
revoke execute on function public.set_online_alerts(boolean) from public, anon;
grant  execute on function public.set_online_alerts(boolean) to authenticated;

-- 2) The nudge log now also records automatic "came online" alerts (separate rate limit from the 👋 button)
alter table public.nudges add column if not exists kind text not null default 'nudge';
alter table public.nudges drop constraint if exists nudges_kind_check;
alter table public.nudges add constraint nudges_kind_check check (kind in ('nudge', 'online'));
create index if not exists nudges_kind_idx on public.nudges (sender_id, receiver_id, kind, created_at desc);

-- Note: "Clear chat" and the 15-minute deletion run on the server (/api/clear-chat, /api/purge-expired)
-- with the service role key, so no new table permissions are needed for them.
