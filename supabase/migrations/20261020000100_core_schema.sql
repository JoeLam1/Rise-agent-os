-- RISE Agent OS — Sprint 001 core schema
--
-- Tenancy model: every business row carries org_id. Child tables reference
-- their parent with a composite (org_id, id) foreign key so a row can never
-- point at a parent in another organization. All access from the app goes
-- through the anon/authenticated roles, so Row Level Security is the
-- enforcement boundary. The app never uses the service-role key in Sprint 001.

create extension if not exists pgcrypto;

-- Helper functions live in a schema that PostgREST does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('agent', 'broker', 'admin');
create type public.transaction_side as enum ('buyer', 'seller', 'dual', 'landlord', 'tenant');
create type public.transaction_status as enum ('draft', 'active', 'under_contract', 'closed', 'cancelled');
create type public.document_kind as enum (
  'purchase_agreement', 'listing_agreement', 'addendum', 'disclosure', 'lease', 'other'
);
create type public.review_type as enum ('pre_signature', 'post_execution');
create type public.review_state as enum (
  'pending_analysis', 'ready_for_broker', 'changes_requested', 'approved', 'rejected', 'withdrawn'
);
create type public.analysis_engine as enum ('mock', 'nj_contract_ai');
create type public.analysis_status as enum ('queued', 'running', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'agent',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  agent_id uuid not null references auth.users (id) on delete restrict,
  property_address text not null check (length(trim(property_address)) between 3 and 300),
  property_city text,
  property_state text not null default 'NJ' check (property_state ~ '^[A-Z]{2}$'),
  side public.transaction_side not null,
  status public.transaction_status not null default 'draft',
  expected_close_date date,
  notes text,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create index transactions_org_idx on public.transactions (org_id, created_at desc);
create index transactions_agent_idx on public.transactions (agent_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  transaction_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  kind public.document_kind not null default 'other',
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, transaction_id) references public.transactions (org_id, id) on delete restrict
);
create index documents_transaction_idx on public.documents (transaction_id);

-- One row per uploaded file. Rows are immutable once written (see trigger).
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_id uuid not null,
  version_number integer not null check (version_number > 0),
  storage_bucket text not null default 'transaction-documents',
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  mime_type text not null,
  original_filename text not null,
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (org_id, id),
  foreign key (org_id, document_id) references public.documents (org_id, id) on delete restrict
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  transaction_id uuid not null,
  document_version_id uuid not null,
  review_type public.review_type not null,
  state public.review_state not null default 'pending_analysis',
  requested_by uuid not null references auth.users (id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, transaction_id) references public.transactions (org_id, id) on delete restrict,
  foreign key (org_id, document_version_id) references public.document_versions (org_id, id) on delete restrict,
  check ((state in ('approved', 'changes_requested', 'rejected')) = (decided_by is not null and decided_at is not null))
);
create index reviews_queue_idx on public.reviews (org_id, review_type, state, requested_at);
-- At most one open review of each type per document version.
create unique index reviews_one_open_per_version
  on public.reviews (document_version_id, review_type)
  where state in ('pending_analysis', 'ready_for_broker');

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  review_id uuid not null,
  engine public.analysis_engine not null,
  engine_version text not null,
  is_mock boolean generated always as (engine = 'mock') stored,
  status public.analysis_status not null default 'queued',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (org_id, review_id) references public.reviews (org_id, id) on delete restrict
);
create index analysis_runs_review_idx on public.analysis_runs (review_id, created_at desc);

-- Append-only. Written only by security-definer triggers and functions.
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete restrict,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create function private.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

-- Brokers and admins see every transaction in their org; agents see their own.
create function private.can_access_transaction(p_transaction uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.transactions t
    join public.memberships m on m.org_id = t.org_id and m.user_id = auth.uid()
    where t.id = p_transaction
      and (m.role in ('broker', 'admin') or t.agent_id = auth.uid())
  );
$$;

create function private.can_access_document(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document and private.can_access_transaction(d.transaction_id)
  );
$$;

-- Storage paths are "<org_id>/<transaction_id>/<document_id>/<file>".
create function private.can_access_storage_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
  v_org uuid;
  v_txn uuid;
  v_doc uuid;
begin
  if array_length(parts, 1) <> 4 or parts[4] = '' then
    return false;
  end if;
  begin
    v_org := parts[1]::uuid;
    v_txn := parts[2]::uuid;
    v_doc := parts[3]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.documents d
    where d.id = v_doc and d.transaction_id = v_txn and d.org_id = v_org
      and private.can_access_transaction(d.transaction_id)
  );
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, public.org_role[]),
  private.can_access_transaction(uuid),
  private.can_access_document(uuid),
  private.can_access_storage_path(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactions_touch before update on public.transactions
  for each row execute function private.touch_updated_at();
create trigger reviews_touch before update on public.reviews
  for each row execute function private.touch_updated_at();

-- A transaction's agent must belong to the transaction's organization, and
-- org_id / created_by can never be rewritten.
create function private.transactions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.created_by <> old.created_by) then
    raise exception 'org_id and created_by are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m where m.org_id = new.org_id and m.user_id = new.agent_id
  ) then
    raise exception 'assigned agent is not a member of this organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger transactions_guard before insert or update on public.transactions
  for each row execute function private.transactions_guard();

create function private.reject_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are immutable (% blocked)', tg_table_name, tg_op using errcode = '42501';
end;
$$;

create trigger document_versions_immutable before update or delete on public.document_versions
  for each row execute function private.reject_mutation();
create trigger documents_no_delete before delete on public.documents
  for each row execute function private.reject_mutation();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.reject_mutation();
create trigger analysis_runs_no_delete before delete on public.analysis_runs
  for each row execute function private.reject_mutation();
create trigger reviews_no_delete before delete on public.reviews
  for each row execute function private.reject_mutation();

-- Documents may only be renamed or re-classified; their tenancy is fixed.
create function private.documents_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id or new.transaction_id <> old.transaction_id
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'document tenancy fields are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger documents_guard before update on public.documents
  for each row execute function private.documents_guard();

-- Review state machine, enforced for every writer including service_role.
create function private.review_transition_allowed(p_from public.review_state, p_to public.review_state)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('pending_analysis'::public.review_state, 'ready_for_broker'::public.review_state),
    ('pending_analysis', 'withdrawn'),
    ('ready_for_broker', 'approved'),
    ('ready_for_broker', 'changes_requested'),
    ('ready_for_broker', 'rejected'),
    ('ready_for_broker', 'withdrawn')
  );
$$;

create function private.reviews_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id or new.transaction_id <> old.transaction_id
     or new.document_version_id <> old.document_version_id or new.review_type <> old.review_type
     or new.requested_by <> old.requested_by or new.requested_at <> old.requested_at then
    raise exception 'review identity fields are immutable' using errcode = '42501';
  end if;
  if new.state is distinct from old.state
     and not private.review_transition_allowed(old.state, new.state) then
    raise exception 'invalid review transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if new.state = old.state and (
       new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
       or new.decision_note is distinct from old.decision_note) then
    raise exception 'decision fields can only change with a state transition' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger reviews_guard before update on public.reviews
  for each row execute function private.reviews_guard();

-- ---------------------------------------------------------------------------
-- Audit logging
-- ---------------------------------------------------------------------------
create function private.write_audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entity text := tg_argv[0];
  v_org uuid;
  v_action text;
  v_meta jsonb := '{}'::jsonb;
begin
  if v_entity = 'organization' then
    v_org := new.id;
  else
    v_org := new.org_id;
  end if;
  if tg_op = 'INSERT' then
    v_action := v_entity || '.created';
  else
    v_action := v_entity || '.updated';
  end if;

  if v_entity = 'review' then
    v_meta := jsonb_build_object('review_type', new.review_type, 'state', new.state,
                                 'document_version_id', new.document_version_id);
    if tg_op = 'UPDATE' and new.state is distinct from old.state then
      v_action := 'review.' || new.state::text;
      v_meta := v_meta || jsonb_build_object('from_state', old.state, 'note', new.decision_note);
    end if;
  elsif v_entity = 'transaction' and tg_op = 'UPDATE' then
    v_meta := jsonb_build_object('from_status', old.status, 'status', new.status);
  elsif v_entity = 'document_version' then
    v_meta := jsonb_build_object('document_id', new.document_id, 'version_number', new.version_number,
                                 'sha256', new.sha256, 'size_bytes', new.size_bytes);
  elsif v_entity = 'membership' then
    v_meta := jsonb_build_object('user_id', new.user_id, 'role', new.role);
  elsif v_entity = 'analysis_run' then
    v_meta := jsonb_build_object('review_id', new.review_id, 'engine', new.engine,
                                 'engine_version', new.engine_version, 'status', new.status,
                                 'is_mock', new.engine = 'mock');
  end if;

  perform private.write_audit(v_org, v_action, v_entity, new.id, v_meta);
  return null;
end;
$$;

create trigger audit_organizations after insert or update on public.organizations
  for each row execute function private.audit_row('organization');
create trigger audit_memberships after insert or update on public.memberships
  for each row execute function private.audit_row('membership');
create trigger audit_transactions after insert or update on public.transactions
  for each row execute function private.audit_row('transaction');
create trigger audit_documents after insert or update on public.documents
  for each row execute function private.audit_row('document');
create trigger audit_document_versions after insert on public.document_versions
  for each row execute function private.audit_row('document_version');
create trigger audit_reviews after insert or update on public.reviews
  for each row execute function private.audit_row('review');
create trigger audit_analysis_runs after insert or update on public.analysis_runs
  for each row execute function private.audit_row('analysis_run');

create function private.audit_membership_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_audit(old.org_id, 'membership.removed', 'membership', old.id,
                              jsonb_build_object('user_id', old.user_id, 'role', old.role));
  return null;
end;
$$;
create trigger audit_memberships_delete after delete on public.memberships
  for each row execute function private.audit_membership_delete();

-- ---------------------------------------------------------------------------
-- Profiles follow auth.users
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.transactions enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.reviews enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.audit_log enable row level security;

-- Supabase grants broad table privileges to anon/authenticated by default.
-- Narrow them so RLS is not the only layer.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on public.organizations, public.memberships,
  public.document_versions, public.reviews, public.analysis_runs, public.audit_log
  from authenticated;
revoke delete, truncate on public.transactions, public.documents, public.profiles from authenticated;
revoke insert on public.profiles from authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.transactions, public.documents to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant insert, update, delete on public.memberships to authenticated;

create policy organizations_select on public.organizations
  for select to authenticated using (private.is_org_member(id));

create policy profiles_select on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_select on public.memberships
  for select to authenticated using (private.is_org_member(org_id));
create policy memberships_admin_insert on public.memberships
  for insert to authenticated with check (private.has_org_role(org_id, array['admin']::public.org_role[]));
create policy memberships_admin_update on public.memberships
  for update to authenticated
  using (private.has_org_role(org_id, array['admin']::public.org_role[]) and user_id <> auth.uid())
  with check (private.has_org_role(org_id, array['admin']::public.org_role[]));
create policy memberships_admin_delete on public.memberships
  for delete to authenticated
  using (private.has_org_role(org_id, array['admin']::public.org_role[]) and user_id <> auth.uid());

create policy transactions_select on public.transactions
  for select to authenticated using (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    or (agent_id = auth.uid() and private.is_org_member(org_id))
  );
create policy transactions_insert on public.transactions
  for insert to authenticated with check (
    created_by = auth.uid()
    and (
      (agent_id = auth.uid() and private.is_org_member(org_id))
      or private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    )
  );
create policy transactions_update on public.transactions
  for update to authenticated
  using (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    or (agent_id = auth.uid() and private.is_org_member(org_id))
  )
  with check (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    or (agent_id = auth.uid() and private.is_org_member(org_id))
  );

create policy documents_select on public.documents
  for select to authenticated using (private.can_access_transaction(transaction_id));
create policy documents_insert on public.documents
  for insert to authenticated with check (
    created_by = auth.uid() and private.can_access_transaction(transaction_id)
  );
create policy documents_update on public.documents
  for update to authenticated
  using (private.can_access_transaction(transaction_id))
  with check (private.can_access_transaction(transaction_id));

create policy document_versions_select on public.document_versions
  for select to authenticated using (private.can_access_document(document_id));

create policy reviews_select on public.reviews
  for select to authenticated using (private.can_access_transaction(transaction_id));

create policy analysis_runs_select on public.analysis_runs
  for select to authenticated using (
    exists (select 1 from public.reviews r
            where r.id = analysis_runs.review_id and private.can_access_transaction(r.transaction_id))
  );

create policy audit_log_select on public.audit_log
  for select to authenticated using (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
  );
