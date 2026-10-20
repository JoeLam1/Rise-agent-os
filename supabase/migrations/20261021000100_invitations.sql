-- Sprint 003: invitations.
--
-- An admin invites an email address with a role. If a confirmed account already
-- exists the person is added straight away (same as add_org_member). Otherwise an
-- invitation is stored, and the app asks Supabase Auth to email the person a
-- sign-in link. The membership is created only once that email address is
-- confirmed in auth.users, so nobody can claim an invitation by signing up
-- with someone else's address. This relies on the auth server requiring email
-- confirmation ("Confirm email" on; enable_confirmations in config.toml).

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  email text not null check (email = lower(trim(email)) and email like '%_@_%'),
  role public.org_role not null default 'agent',
  invited_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  unique (org_id, id),
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_at is null or revoked_at is null)
);
-- One open invitation per address per brokerage.
create unique index invitations_one_open
  on public.invitations (org_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_email_idx on public.invitations (email)
  where accepted_at is null and revoked_at is null;

alter table public.invitations enable row level security;
revoke all on public.invitations from anon;
revoke insert, update, delete, truncate on public.invitations from authenticated;
grant select on public.invitations to authenticated;

create policy invitations_admin_select on public.invitations
  for select to authenticated using (private.has_org_role(org_id, array['admin']::public.org_role[]));

-- Accepted and revoked invitations are history: they can't change again.
create function private.invitations_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id or new.email <> old.email or new.role <> old.role
     or new.invited_by <> old.invited_by or new.created_at <> old.created_at then
    raise exception 'invitation identity fields are immutable' using errcode = '42501';
  end if;
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'closed invitations are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger invitations_guard before update on public.invitations
  for each row execute function private.invitations_guard();
create trigger invitations_no_delete before delete on public.invitations
  for each row execute function private.reject_mutation();

create trigger audit_invitations after insert or update on public.invitations
  for each row execute function private.audit_row('invitation');

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Returns 'added' when an account already existed and was added, or
-- 'invited' when an invitation was stored and an email should be sent.
create function public.invite_member(p_org uuid, p_email text, p_role public.org_role)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can invite members' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email address' using errcode = '22023';
  end if;

  -- Only a confirmed account counts as existing; an unconfirmed sign-up with
  -- this address gets an invitation and joins once it confirms.
  select u.id into v_user from auth.users u
  where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    insert into public.memberships (org_id, user_id, role) values (p_org, v_user, p_role);
    return 'added';
  end if;

  -- Re-inviting replaces the open invitation (new role, new expiry).
  update public.invitations set revoked_at = now()
  where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.invitations (org_id, email, role, invited_by)
  values (p_org, v_email, p_role, auth.uid());
  return 'invited';
end;
$$;

create function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation for update;
  if v_inv.id is null or not private.has_org_role(v_inv.org_id, array['admin']::public.org_role[]) then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'invitation is already closed' using errcode = '23514';
  end if;
  update public.invitations set revoked_at = now() where id = v_inv.id;
end;
$$;

revoke all on function public.invite_member(uuid, text, public.org_role) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, public.org_role) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting: when an auth user's email is (or becomes) confirmed
-- ---------------------------------------------------------------------------
create function private.accept_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
begin
  if new.email_confirmed_at is null or new.email is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null and old.email = new.email then
    return null;
  end if;
  for v_inv in
    select * from public.invitations i
    where i.email = lower(new.email) and i.accepted_at is null and i.revoked_at is null
      and i.expires_at > now()
    for update
  loop
    insert into public.memberships (org_id, user_id, role)
    values (v_inv.org_id, new.id, v_inv.role)
    on conflict (org_id, user_id) do nothing;
    update public.invitations set accepted_at = now(), accepted_by = new.id where id = v_inv.id;
  end loop;
  return null;
end;
$$;
revoke all on function private.accept_invitations() from public, anon, authenticated;

-- Runs after on_auth_user_created (alphabetical order), so the profile exists.
create trigger on_auth_user_email_confirmed
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function private.accept_invitations();
