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
  hidden      boolean not null default false
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
  with check (sender_id = auth.uid() and public.is_approved() and public.is_approved(receiver_id));

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

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.messages;

-- ---------- Optional: automatic weekly cleanup (enable pg_cron under Database → Extensions) ----------
-- select cron.schedule('weekly-message-purge', '0 3 * * 0',
--   $$ delete from public.messages where "timestamp" < now() - interval '1 day' $$);

-- ---------- Create your first admin ----------
-- 1) Supabase → Authentication → Users → Add user (email + password, tick "Auto confirm").
-- 2) Then run (replace the email):
-- insert into public.admins (id, email) select id, email from auth.users where email = 'you@example.com';
