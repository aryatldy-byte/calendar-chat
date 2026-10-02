-- =====================================================================
-- Calendar Chat – database schema + Row Level Security
-- Run this whole file once in Supabase → SQL Editor.
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  password_hash text,                         -- unused: Supabase Auth stores the real hash in auth.users
  approved      boolean not null default false,
  rejected      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.admins (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  password_hash text                          -- unused, see above
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 2000),
  "timestamp" timestamptz not null default now(),
  hidden      boolean not null default false,
  status      text not null default 'sent' check (status in ('sent','delivered','seen'))
);
create index if not exists messages_ts_idx on public.messages ("timestamp");

-- ---------- Helper functions ----------
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where id = auth.uid());
$$;

create or replace function public.is_approved(uid uuid default auth.uid()) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.users where id = uid and approved and not rejected);
$$;

-- ---------- Auto-create a profile row on signup (approved = false) ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Hard limit: at most 2 approved users ----------
create or replace function public.enforce_two_users() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved and (select count(*) from public.users where approved and id <> new.id) >= 2 then
    raise exception 'Only 2 users can be approved.';
  end if;
  return new;
end $$;

drop trigger if exists two_users_only on public.users;
create trigger two_users_only before insert or update on public.users
  for each row execute function public.enforce_two_users();

-- ---------- Row Level Security ----------
alter table public.users    enable row level security;
alter table public.admins   enable row level security;
alter table public.messages enable row level security;

-- users: see yourself, the other approved user, or everyone if admin. Only admins modify.
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_admin() or (approved and public.is_approved()));
drop policy if exists users_admin_update on public.users;
create policy users_admin_update on public.users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists users_admin_delete on public.users;
create policy users_admin_delete on public.users for delete to authenticated
  using (public.is_admin());

-- admins: you can only see your own row (used to check admin status)
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins for select to authenticated
  using (id = auth.uid());

-- messages: only the two participants, only while approved. Admins cannot read content.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_approved() and (sender_id = auth.uid() or receiver_id = auth.uid()));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and status = 'sent' and public.is_approved() and public.is_approved(receiver_id));

-- ---------- Admin-only maintenance (no read access to content needed) ----------
create or replace function public.admin_message_count() returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return (select count(*) from public.messages);
end $$;

create or replace function public.admin_purge_messages(older_than_minutes int default 0) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.messages where "timestamp" < now() - make_interval(mins => older_than_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.admin_message_count()      from public, anon;
revoke execute on function public.admin_purge_messages(int)  from public, anon;
grant  execute on function public.admin_message_count()      to authenticated;
grant  execute on function public.admin_purge_messages(int)  to authenticated;

-- ---------- Seen ticks ----------
-- Recipient marks messages as seen via this function (no UPDATE policy needed on the table)
create or replace function public.mark_messages_seen() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_approved() then return 0; end if;
  update public.messages set status = 'seen'
   where receiver_id = auth.uid() and status <> 'seen';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.mark_messages_seen() from public, anon;
grant  execute on function public.mark_messages_seen() to authenticated;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.messages;

-- ---------- Optional: automatic weekly cleanup (enable pg_cron under Database → Extensions) ----------
-- select cron.schedule('weekly-message-purge', '0 3 * * 0',
--   $$ delete from public.messages where "timestamp" < now() - interval '1 day' $$);

-- ---------- Create your first admin ----------
-- 1) Supabase → Authentication → Users → Add user (email + password, tick "Auto confirm").
-- 2) Then run (replace the email):
-- insert into public.admins (id, email) select id, email from auth.users where email = 'you@example.com';

-- =====================================================================
-- PART 2: ticks + push (same as migration_002_ticks_and_push.sql)
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

-- =====================================================================
-- PART 3: multi-user (same as migration_003_multi_user.sql)
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
