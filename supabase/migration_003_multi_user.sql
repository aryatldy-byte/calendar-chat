-- =====================================================================
-- Migration 003: many users, private 1-to-1 chats controlled by the admin
-- Safe to run more than once. Run in Supabase → SQL Editor.
-- =====================================================================

-- 1) Remove the "max 2 approved users" limit
drop trigger  if exists two_users_only on public.users;
drop function if exists public.enforce_two_users();

-- 2) Pairings: which users are allowed to chat with each other (one row per pair)
create table if not exists public.pairings (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references public.users(id) on delete cascade,
  user_b     uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a < user_b),           -- stored in a fixed order so a pair exists only once
  unique (user_a, user_b)
);
alter table public.pairings enable row level security;

create or replace function public.are_paired(a uuid, b uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.pairings where user_a = least(a, b) and user_b = greatest(a, b));
$$;

drop policy if exists pairings_select on public.pairings;
create policy pairings_select on public.pairings for select to authenticated
  using (public.is_admin() or user_a = auth.uid() or user_b = auth.uid());
drop policy if exists pairings_admin_delete on public.pairings;
create policy pairings_admin_delete on public.pairings for delete to authenticated
  using (public.is_admin());

create or replace function public.admin_pair_users(a uuid, b uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if a = b then raise exception 'Choose two different users.'; end if;
  insert into public.pairings (user_a, user_b) values (least(a, b), greatest(a, b))
  on conflict do nothing;
end $$;

revoke execute on function public.are_paired(uuid, uuid)     from public, anon;
revoke execute on function public.admin_pair_users(uuid, uuid) from public, anon;
grant  execute on function public.are_paired(uuid, uuid)     to authenticated;
grant  execute on function public.admin_pair_users(uuid, uuid) to authenticated;

-- 3) Users now only see themselves and the people they are paired with (admins see all)
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_admin()
         or (approved and public.is_approved() and public.are_paired(id, auth.uid())));

-- 4) Messages only between paired, approved users
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_approved() and (sender_id = auth.uid() or receiver_id = auth.uid())
         and public.are_paired(sender_id, receiver_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and status = 'sent'
              and public.is_approved() and public.is_approved(receiver_id)
              and public.are_paired(sender_id, receiver_id));

-- 5) Keep today's chat working: pair the users who are already approved
insert into public.pairings (user_a, user_b)
select a.id, b.id from public.users a join public.users b on a.id < b.id
where a.approved and b.approved
on conflict do nothing;
