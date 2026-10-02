-- Message status ticks. Safe to run more than once.
alter table public.messages add column if not exists status text not null default 'sent';

alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('sent', 'delivered', 'seen'));

-- Senders may only create messages with status 'sent' (cannot fake "seen")
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and status = 'sent'
              and public.is_approved() and public.is_approved(receiver_id));

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
