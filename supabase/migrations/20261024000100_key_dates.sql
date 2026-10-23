-- Sprint 006: key dates on a transaction (attorney review end, inspection,
-- mortgage commitment, closing, ...), entered by people. The software never
-- computes a legal deadline; it only shows the dates people wrote down.

create type public.key_date_kind as enum (
  'attorney_review_end', 'inspection', 'mortgage_commitment', 'appraisal', 'closing', 'other'
);

create table public.transaction_dates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  transaction_id uuid not null,
  kind public.key_date_kind not null,
  label text check (label is null or length(trim(label)) between 1 and 120),
  due_on date not null,
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete restrict,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, transaction_id) references public.transactions (org_id, id) on delete restrict,
  check (kind <> 'other' or label is not null),
  check ((completed_at is null) = (completed_by is null))
);
create index transaction_dates_txn_idx on public.transaction_dates (transaction_id, due_on);
create index transaction_dates_open_idx on public.transaction_dates (org_id, due_on) where completed_at is null;

alter table public.transaction_dates enable row level security;
revoke all on public.transaction_dates from anon;
revoke truncate on public.transaction_dates from authenticated;
grant select, insert, update, delete on public.transaction_dates to authenticated;

-- Whoever can see the transaction (its agent, or a broker or admin) can
-- manage its dates.
create policy transaction_dates_select on public.transaction_dates
  for select to authenticated using (private.can_access_transaction(transaction_id));
create policy transaction_dates_insert on public.transaction_dates
  for insert to authenticated with check (created_by = auth.uid() and private.can_access_transaction(transaction_id));
create policy transaction_dates_update on public.transaction_dates
  for update to authenticated
  using (private.can_access_transaction(transaction_id))
  with check (private.can_access_transaction(transaction_id));
create policy transaction_dates_delete on public.transaction_dates
  for delete to authenticated using (private.can_access_transaction(transaction_id));

-- org, transaction and author can't be rewritten; completion is stamped by
-- the database, not the client.
create function private.transaction_dates_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.transaction_id <> old.transaction_id
                           or new.created_by <> old.created_by or new.created_at <> old.created_at) then
    raise exception 'org, transaction and author of a key date are immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.completed_at is distinct from old.completed_at then
    if new.completed_at is not null then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_by := null;
    end if;
  else
    new.completed_by := old.completed_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger transaction_dates_guard before insert or update on public.transaction_dates
  for each row execute function private.transaction_dates_guard();

create function private.audit_transaction_date()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row public.transaction_dates := case when tg_op = 'DELETE' then old else new end;
  v_action text := case tg_op when 'INSERT' then 'key_date.created' when 'DELETE' then 'key_date.deleted'
                   else 'key_date.updated' end;
begin
  if tg_op = 'UPDATE' and new.completed_at is distinct from old.completed_at then
    v_action := case when new.completed_at is null then 'key_date.reopened' else 'key_date.completed' end;
  end if;
  perform private.write_audit(v_row.org_id, v_action, 'key_date', v_row.id,
    jsonb_build_object('transaction_id', v_row.transaction_id, 'kind', v_row.kind, 'label', v_row.label,
                       'due_on', v_row.due_on)
    || case when tg_op = 'UPDATE' and new.due_on <> old.due_on
            then jsonb_build_object('from_due_on', old.due_on) else '{}'::jsonb end);
  return null;
end;
$$;
create trigger audit_transaction_dates after insert or update or delete on public.transaction_dates
  for each row execute function private.audit_transaction_date();
