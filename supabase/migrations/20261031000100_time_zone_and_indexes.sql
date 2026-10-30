-- Sprint 007:
--   * organizations.time_zone, the brokerage's calendar for key dates and
--     "today". Changed only by an admin through public.set_org_time_zone (audited).
--   * Indexes for every foreign key the Supabase performance advisor flagged.
--   * RLS policies call auth.uid() once per statement, not once per row.
--   * private.mfa_backup_code_failures gets a primary key.

alter table public.organizations
  add column time_zone text not null default 'America/New_York';

create function public.set_org_time_zone(p_org uuid, p_time_zone text)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_old text;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only an admin can change the time zone' using errcode = '42501';
  end if;
  perform private.require_aal2();
  if p_time_zone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone)
     or p_time_zone !~ '^[A-Za-z]+/[A-Za-z_-]+(/[A-Za-z_-]+)?$' then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  select o.time_zone into v_old from public.organizations o where o.id = p_org;
  update public.organizations set time_zone = p_time_zone where id = p_org
  returning * into v_org;
  perform private.write_audit(p_org, 'organization.time_zone_changed', 'organization', p_org,
    jsonb_build_object('from', v_old, 'to', p_time_zone));
  return v_org;
end;
$$;
revoke all on function public.set_org_time_zone(uuid, text) from public, anon;
grant execute on function public.set_org_time_zone(uuid, text) to authenticated;

-- Foreign keys without a covering index.
create index analysis_runs_org_review_idx on public.analysis_runs (org_id, review_id);
create index document_versions_org_document_idx on public.document_versions (org_id, document_id);
create index document_versions_uploaded_by_idx on public.document_versions (uploaded_by);
create index documents_created_by_idx on public.documents (created_by);
create index documents_org_transaction_idx on public.documents (org_id, transaction_id);
create index invitations_accepted_by_idx on public.invitations (accepted_by);
create index invitations_invited_by_idx on public.invitations (invited_by);
create index organizations_created_by_idx on public.organizations (created_by);
create index reviews_decided_by_idx on public.reviews (decided_by);
create index reviews_org_document_version_idx on public.reviews (org_id, document_version_id);
create index reviews_org_transaction_idx on public.reviews (org_id, transaction_id);
create index reviews_requested_by_idx on public.reviews (requested_by);
create index transaction_dates_completed_by_idx on public.transaction_dates (completed_by);
create index transaction_dates_created_by_idx on public.transaction_dates (created_by);
create index transaction_dates_org_transaction_idx on public.transaction_dates (org_id, transaction_id);
create index transactions_created_by_idx on public.transactions (created_by);

-- Same rules as before; (select auth.uid()) is evaluated once per statement.
alter policy profiles_select on public.profiles
  using (
    id = (select auth.uid()) or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
alter policy profiles_update_self on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy transactions_select on public.transactions
  using (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    or (agent_id = (select auth.uid()) and private.is_org_member(org_id))
  );
alter policy transactions_insert on public.transactions
  with check (
    created_by = (select auth.uid())
    and (
      (agent_id = (select auth.uid()) and private.is_org_member(org_id))
      or private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    )
  );
alter policy transactions_update on public.transactions
  using (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    or (agent_id = (select auth.uid()) and private.is_org_member(org_id))
  )
  with check (
    private.has_org_role(org_id, array['broker', 'admin']::public.org_role[])
    or (agent_id = (select auth.uid()) and private.is_org_member(org_id))
  );

alter policy documents_insert on public.documents
  with check (created_by = (select auth.uid()) and private.can_access_transaction(transaction_id));

alter policy transaction_dates_insert on public.transaction_dates
  with check (created_by = (select auth.uid()) and private.can_access_transaction(transaction_id));

-- Rows are only ever inserted and counted; a surrogate key keeps the table
-- addressable.
alter table private.mfa_backup_code_failures
  add column id bigint generated always as identity primary key;
