-- Sprint 005: hand a removed agent's transactions to someone still in the
-- brokerage.

-- Removing a member left their transactions stuck: the guard re-checked the
-- agent's membership on every update, so even a status change failed. Check
-- membership only when the agent is first set or changed.
create or replace function private.transactions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.created_by <> old.created_by) then
    raise exception 'org_id and created_by are immutable' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id) and not exists (
    select 1 from public.memberships m where m.org_id = new.org_id and m.user_id = new.agent_id
  ) then
    raise exception 'assigned agent is not a member of this organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- People who still have transactions in the brokerage but are no longer
-- members, for the admin's Members page. Their profiles are otherwise hidden
-- once they leave (profiles_select needs a shared brokerage).
create function public.former_member_transactions(p_org uuid)
returns table (agent_id uuid, email text, full_name text, open_count integer, total_count integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_org_role(p_org, array['broker', 'admin']::public.org_role[]) then
    raise exception 'only brokers and admins can see this' using errcode = '42501';
  end if;
  return query
    select t.agent_id, p.email, p.full_name,
           (count(*) filter (where t.status not in ('closed', 'cancelled')))::integer,
           count(*)::integer
    from public.transactions t
    left join public.profiles p on p.id = t.agent_id
    where t.org_id = p_org
      and not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = t.agent_id)
    group by t.agent_id, p.email, p.full_name
    order by p.full_name nulls last, p.email;
end;
$$;

-- Moves every transaction of one agent to another member, open or closed, so
-- the history stays with whoever now answers for it. Each one is audited with
-- the old and new agent.
create function public.reassign_transactions(p_org uuid, p_from uuid, p_to uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if not private.has_org_role(p_org, array['broker', 'admin']::public.org_role[]) then
    raise exception 'only brokers and admins can reassign transactions' using errcode = '42501';
  end if;
  perform private.require_aal2();
  if p_from = p_to then
    raise exception 'choose a different person' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_to) then
    raise exception 'the new agent must be a member of this brokerage' using errcode = '23514';
  end if;
  for v_id in
    update public.transactions set agent_id = p_to
    where org_id = p_org and agent_id = p_from
    returning id
  loop
    perform private.write_audit(p_org, 'transaction.reassigned', 'transaction', v_id,
      jsonb_build_object('from_agent_id', p_from, 'to_agent_id', p_to));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.former_member_transactions(uuid) from public, anon;
revoke all on function public.reassign_transactions(uuid, uuid, uuid) from public, anon;
grant execute on function public.former_member_transactions(uuid) to authenticated;
grant execute on function public.reassign_transactions(uuid, uuid, uuid) to authenticated;
