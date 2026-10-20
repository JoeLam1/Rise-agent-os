-- Sprint 003: two-step sign-in (TOTP) for broker decisions and admin actions.
--
-- Brokers and admins can sign in with a password alone, but deciding a review
-- and every admin action (members, invitations, AI review switch) needs a
-- session at assurance level aal2, i.e. one that has passed a TOTP check in
-- Supabase Auth. The level comes from the signed JWT, so the app can't fake
-- it. Agents' work (transactions, uploads, review requests) is unchanged.

create function private.require_aal2()
returns void
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'two-step sign-in is required for this action'
      using errcode = '42501', hint = 'mfa_required';
  end if;
end;
$$;
revoke all on function private.require_aal2() from public, anon, authenticated;

-- The functions below are unchanged apart from the require_aal2() line.

create or replace function public.decide_review(p_review uuid, p_decision public.review_state, p_note text default null)
returns public.reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_review public.reviews;
begin
  select * into v_review from public.reviews where id = p_review for update;
  if v_review.id is null or not private.can_access_transaction(v_review.transaction_id) then
    raise exception 'review not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(v_review.org_id, array['broker', 'admin']::public.org_role[]) then
    raise exception 'only a broker or admin can decide a review' using errcode = '42501';
  end if;
  perform private.require_aal2();
  if v_review.requested_by = auth.uid() then
    raise exception 'a review cannot be decided by the person who requested it' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'invalid decision %', p_decision using errcode = '22023';
  end if;
  if v_review.state <> 'ready_for_broker' then
    raise exception 'review is not awaiting a broker decision (state %)', v_review.state
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.analysis_runs a
                 where a.review_id = v_review.id and a.status in ('completed', 'failed'))
     or exists (select 1 from public.analysis_runs a
                where a.review_id = v_review.id and a.status in ('queued', 'running')) then
    raise exception 'review analysis has not finished' using errcode = '23514';
  end if;
  if p_decision in ('changes_requested', 'rejected') and coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required when requesting changes or rejecting' using errcode = '22023';
  end if;

  update public.reviews
  set state = p_decision, decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(trim(p_note), '')
  where id = v_review.id
  returning * into v_review;
  return v_review;
end;
$$;

create or replace function public.set_ai_review(p_org uuid, p_enabled boolean)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only an admin can change AI review' using errcode = '42501';
  end if;
  perform private.require_aal2();
  update public.organizations set ai_review_enabled = p_enabled where id = p_org
  returning * into v_org;
  perform private.write_audit(p_org,
    case when p_enabled then 'organization.ai_review_enabled' else 'organization.ai_review_disabled' end,
    'organization', p_org, '{}'::jsonb);
  return v_org;
end;
$$;

create or replace function public.add_org_member(p_org uuid, p_email text, p_role public.org_role)
returns public.memberships
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_membership public.memberships;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can add members' using errcode = '42501';
  end if;
  perform private.require_aal2();
  select p.id into v_user from public.profiles p where lower(p.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no account exists for that email' using errcode = 'P0002';
  end if;
  insert into public.memberships (org_id, user_id, role) values (p_org, v_user, p_role)
  returning * into v_membership;
  return v_membership;
end;
$$;

create or replace function public.invite_member(p_org uuid, p_email text, p_role public.org_role)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can invite members' using errcode = '42501';
  end if;
  perform private.require_aal2();
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

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation for update;
  if v_inv.id is null or not private.has_org_role(v_inv.org_id, array['admin']::public.org_role[]) then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  perform private.require_aal2();
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'invitation is already closed' using errcode = '23514';
  end if;
  update public.invitations set revoked_at = now() where id = v_inv.id;
end;
$$;
