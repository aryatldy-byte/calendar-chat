-- =====================================================================
-- Migration 002: message status ticks + web-push subscriptions
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- =====================================================================

-- 1) Message status: 'sent' (default, saved in Supabase) -> 'seen' (recipient opened chat)
alter table public.messages add column if not exists status text not null default 'sent';
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('sent', 'delivered', 'seen'));

-- Senders may only insert new messages with status 'sent'
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and status = 'sent'
              and public.is_approved() and public.is_approved(receiver_id));

-- The RECEIVER may update ONLY the status column (to mark messages as seen)
revoke update on public.messages from anon, authenticated;
grant  update (status) on public.messages to authenticated;
drop policy if exists messages_mark_seen on public.messages;
create policy messages_mark_seen on public.messages for update to authenticated
  using      (public.is_approved() and receiver_id = auth.uid())
  with check (public.is_approved() and receiver_id = auth.uid());

-- 2) Push notification subscriptions (one row per browser/device)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_insert on public.push_subscriptions;
create policy push_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_update on public.push_subscriptions;
create policy push_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
