-- Sprint 004: managing members, seeing who has two-step sign-in, and backup
-- codes for a lost authenticator.

-- ---------------------------------------------------------------------------
-- Membership writes only through functions
-- ---------------------------------------------------------------------------
-- Sprint 001 let admins write memberships directly under RLS. That path
-- skipped the two-step sign-in requirement added in Sprint 003 and had no
-- "last admin" rule, so every membership change now goes through a function.
drop policy memberships_admin_insert on public.memberships;
drop policy memberships_admin_update on public.memberships;
drop policy memberships_admin_delete on public.memberships;
revoke insert, update, delete on public.memberships from authenticated;

-- Locks the brokerage's admin rows so two admins can't demote each other at
-- the same moment and leave none.
create function private.other_admins(p_org uuid, p_except uuid)
returns integer
language sql volatile security definer set search_path = '' as $$
  select count(*)::integer from (
    select 1 from public.memberships m
    where m.org_id = p_org and m.role = 'admin' and m.id <> p_except
    for update
  ) admins;
$$;
revoke all on function private.other_admins(uuid, uuid) from public, anon, authenticated;

create function public.set_member_role(p_membership uuid, p_role public.org_role)
returns public.memberships
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_org_member(v_m.org_id) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(v_m.org_id, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can change roles' using errcode = '42501';
  end if;
  perform private.require_aal2();
  if v_m.role = p_role then
    return v_m;
  end if;
  if v_m.role = 'admin' and private.other_admins(v_m.org_id, v_m.id) = 0 then
    raise exception 'a brokerage needs at least one admin' using errcode = '23514';
  end if;
  update public.memberships set role = p_role where id = v_m.id returning * into v_m;
  return v_m;
end;
$$;

create function public.remove_member(p_membership uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not private.is_org_member(v_m.org_id) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(v_m.org_id, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can remove members' using errcode = '42501';
  end if;
  perform private.require_aal2();
  if v_m.role = 'admin' and private.other_admins(v_m.org_id, v_m.id) = 0 then
    raise exception 'a brokerage needs at least one admin' using errcode = '23514';
  end if;
  -- Their transactions, documents, reviews and audit history stay with the
  -- brokerage; they just lose access (every policy checks membership).
  delete from public.memberships where id = v_m.id;
end;
$$;

-- Which members have an authenticator app, for the admin's Members page.
-- Reads Auth's factor list, which signed-in users can't query themselves.
create function public.member_two_step_status(p_org uuid)
returns table (user_id uuid, two_step boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can see this' using errcode = '42501';
  end if;
  return query
    select m.user_id, exists (
      select 1 from auth.mfa_factors f
      where f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'
    )
    from public.memberships m
    where m.org_id = p_org;
end;
$$;

revoke all on function public.set_member_role(uuid, public.org_role) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.member_two_step_status(uuid) from public, anon;
grant execute on function public.set_member_role(uuid, public.org_role) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.member_two_step_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backup codes
-- ---------------------------------------------------------------------------
-- Ten single-use codes, shown once. Only their SHA-256 is stored. Using one
-- (after signing in with the password) removes the person's authenticator
-- app so they can set up a new one; it never grants anything else.
create table private.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash bytea not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index mfa_backup_codes_user_idx on private.mfa_backup_codes (user_id) where used_at is null;

create table private.mfa_backup_code_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index mfa_backup_code_failures_idx on private.mfa_backup_code_failures (user_id, failed_at);
revoke all on private.mfa_backup_codes, private.mfa_backup_code_failures from public, anon, authenticated;

create function private.backup_code_hash(p_code text)
returns bytea language sql immutable set search_path = '' as $$
  select pg_catalog.sha256(convert_to(lower(regexp_replace(p_code, '[^0-9a-zA-Z]', '', 'g')), 'UTF8'));
$$;

-- Records an account-level security event in every brokerage the person is in.
create function private.audit_account_event(p_action text)
returns void language sql security definer set search_path = '' as $$
  select private.write_audit(m.org_id, p_action, 'user', auth.uid(), '{}'::jsonb)
  from public.memberships m where m.user_id = auth.uid();
$$;

create function public.create_backup_codes()
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_codes text[] := '{}';
  v_code text;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  perform private.require_aal2();
  -- New codes replace any earlier ones.
  delete from private.mfa_backup_codes where user_id = v_user;
  for i in 1..10 loop
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
    insert into private.mfa_backup_codes (user_id, code_hash) values (v_user, private.backup_code_hash(v_code));
    v_codes := v_codes || v_code;
  end loop;
  perform private.audit_account_event('account.backup_codes_created');
  return v_codes;
end;
$$;

create function public.backup_codes_remaining()
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from private.mfa_backup_codes
  where user_id = auth.uid() and used_at is null;
$$;

-- Returns true when the code was valid and the authenticator was removed.
-- Wrong codes return false (not an error) so the failure is recorded; five
-- failures in 15 minutes lock the form for the rest of that window.
create function public.use_backup_code(p_code text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (select count(*) from private.mfa_backup_code_failures
      where user_id = v_user and failed_at > now() - interval '15 minutes') >= 5 then
    raise exception 'too many attempts; try again in 15 minutes' using errcode = '54000';
  end if;
  select id into v_id from private.mfa_backup_codes
  where user_id = v_user and used_at is null and code_hash = private.backup_code_hash(coalesce(p_code, ''))
  for update;
  if v_id is null then
    insert into private.mfa_backup_code_failures (user_id) values (v_user);
    return false;
  end if;
  update private.mfa_backup_codes set used_at = now() where id = v_id;
  -- Remove the lost authenticator; the person sets up a new one next.
  delete from auth.mfa_factors where user_id = v_user;
  delete from private.mfa_backup_codes where user_id = v_user and used_at is null;
  perform private.audit_account_event('account.two_step_reset_with_backup_code');
  return true;
end;
$$;

revoke all on function public.create_backup_codes() from public, anon;
revoke all on function public.backup_codes_remaining() from public, anon;
revoke all on function public.use_backup_code(text) from public, anon;
grant execute on function public.create_backup_codes() to authenticated;
grant execute on function public.backup_codes_remaining() to authenticated;
grant execute on function public.use_backup_code(text) to authenticated;
revoke all on function private.backup_code_hash(text), private.audit_account_event(text) from public, anon, authenticated;
