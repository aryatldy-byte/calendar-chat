-- =====================================================================
-- Migration 007: "last seen" time + online "nudge" notifications
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- =====================================================================

alter table public.users add column if not exists last_seen_at timestamptz;

-- Each signed-in, approved user records their own last-online time (null = hidden by their privacy setting)
create or replace function public.touch_last_seen(share boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved() then return; end if;
  update public.users set last_seen_at = case when share then now() else null end where id = auth.uid();
end $$;
revoke execute on function public.touch_last_seen(boolean) from public, anon;
grant  execute on function public.touch_last_seen(boolean) to authenticated;

-- Nudge log (rate limiting). No policies on purpose: only the server (service role) reads/writes it.
create table if not exists public.nudges (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists nudges_pair_idx on public.nudges (sender_id, receiver_id, created_at desc);
alter table public.nudges enable row level security;
