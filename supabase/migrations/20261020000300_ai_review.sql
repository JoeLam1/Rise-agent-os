-- Sprint 002: NJ AI contract review.
--
-- Adds an opt-in, per-brokerage AI review path next to the Sprint 001 mock:
--   * organizations.ai_review_enabled, switched only by an admin through
--     public.set_ai_review (audited).
--   * request_review queues an 'nj_contract_ai' run for PDFs when the flag is
--     on; the review stays 'pending_analysis' until a worker finishes.
--   * claim / complete / fail RPCs for the background worker. They are
--     executable by service_role only: no browser session can claim a run or
--     write an analysis result.
--   * A guard trigger enforces the run lifecycle and makes finished runs
--     immutable, for every writer including service_role.
--
-- A failed AI run never blocks the broker: the review moves to
-- 'ready_for_broker' and the broker reviews the document directly.

alter table public.organizations
  add column ai_review_enabled boolean not null default false;

alter table public.analysis_runs
  add column started_at timestamptz,
  add column attempts integer not null default 0 check (attempts between 0 and 10);

create index analysis_runs_queue_idx on public.analysis_runs (status, created_at)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Run lifecycle guard
-- ---------------------------------------------------------------------------
create function private.analysis_runs_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id or new.review_id <> old.review_id or new.engine <> old.engine
     or new.created_at <> old.created_at then
    raise exception 'analysis run identity fields are immutable' using errcode = '42501';
  end if;
  if old.status in ('completed', 'failed') then
    raise exception 'finished analysis runs are immutable' using errcode = '42501';
  end if;
  if not ((old.status, new.status) in (
      ('queued'::public.analysis_status, 'running'::public.analysis_status),
      ('queued', 'failed'),
      ('running', 'running'),   -- a stale run reclaimed by another worker
      ('running', 'completed'),
      ('running', 'failed'))) then
    raise exception 'invalid analysis run transition % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  if new.status = 'completed' and new.result is null then
    raise exception 'a completed run needs a result' using errcode = '23514';
  end if;
  if new.status <> 'completed' and new.result is not null then
    raise exception 'only a completed run can carry a result' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger analysis_runs_guard before update on public.analysis_runs
  for each row execute function private.analysis_runs_guard();

-- ---------------------------------------------------------------------------
-- Admin switch
-- ---------------------------------------------------------------------------
create function public.set_ai_review(p_org uuid, p_enabled boolean)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only an admin can change AI review' using errcode = '42501';
  end if;
  update public.organizations set ai_review_enabled = p_enabled where id = p_org
  returning * into v_org;
  perform private.write_audit(p_org,
    case when p_enabled then 'organization.ai_review_enabled' else 'organization.ai_review_disabled' end,
    'organization', p_org, '{}'::jsonb);
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Requesting a review now picks the engine
-- ---------------------------------------------------------------------------
create or replace function public.request_review(p_document_version uuid, p_review_type public.review_type)
returns public.reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_version public.document_versions;
  v_doc public.documents;
  v_review public.reviews;
  v_ai boolean;
begin
  select * into v_version from public.document_versions where id = p_document_version;
  if v_version.id is null then
    raise exception 'document version not found' using errcode = 'P0002';
  end if;
  select * into v_doc from public.documents where id = v_version.document_id;
  if not private.can_access_transaction(v_doc.transaction_id) then
    raise exception 'document version not found' using errcode = 'P0002';
  end if;

  insert into public.reviews (org_id, transaction_id, document_version_id, review_type, requested_by)
  values (v_doc.org_id, v_doc.transaction_id, v_version.id, p_review_type, auth.uid())
  returning * into v_review;

  select o.ai_review_enabled into v_ai from public.organizations o where o.id = v_doc.org_id;

  if v_ai and v_version.mime_type = 'application/pdf' then
    -- The worker fills in engine_version when it claims the run.
    insert into public.analysis_runs (org_id, review_id, engine, engine_version, status)
    values (v_doc.org_id, v_review.id, 'nj_contract_ai', 'pending', 'queued');
    return v_review;
  end if;

  -- Mock path: AI review is off for this brokerage, or the file isn't a PDF.
  insert into public.analysis_runs (org_id, review_id, engine, engine_version, status, result, completed_at)
  values (v_doc.org_id, v_review.id, 'mock', 'mock-0.1.0', 'completed',
          private.mock_analysis_result(p_review_type, v_doc.kind), now());

  update public.reviews set state = 'ready_for_broker' where id = v_review.id
  returning * into v_review;
  return v_review;
end;
$$;

-- A broker can decide once analysis has finished, whether it completed or
-- failed. A failed AI run means the broker reviews the document unaided.
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

-- Withdrawing also cancels analysis that hasn't started.
create or replace function public.withdraw_review(p_review uuid)
returns public.reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_review public.reviews;
begin
  select * into v_review from public.reviews where id = p_review for update;
  if v_review.id is null or not private.can_access_transaction(v_review.transaction_id) then
    raise exception 'review not found' using errcode = 'P0002';
  end if;
  if v_review.requested_by <> auth.uid()
     and not private.has_org_role(v_review.org_id, array['broker', 'admin']::public.org_role[]) then
    raise exception 'only the requester or a broker can withdraw a review' using errcode = '42501';
  end if;
  update public.reviews set state = 'withdrawn' where id = v_review.id returning * into v_review;
  update public.analysis_runs
  set status = 'failed', error = 'Review withdrawn before analysis started.', completed_at = now()
  where review_id = v_review.id and status = 'queued';
  return v_review;
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker RPCs (service_role only)
-- ---------------------------------------------------------------------------
create function private.finish_review_analysis(p_review uuid)
returns void language sql security definer set search_path = '' as $$
  update public.reviews set state = 'ready_for_broker'
  where id = p_review and state = 'pending_analysis';
$$;

-- Claims the oldest waiting run. A run left 'running' longer than
-- p_stale_after (a crashed worker) is claimed again, up to p_max_attempts;
-- after that it fails so the review reaches the broker.
create function public.claim_analysis_run(
  p_engine_version text,
  p_stale_after interval default interval '15 minutes',
  p_max_attempts integer default 3
)
returns table (
  run_id uuid, org_id uuid, review_id uuid, review_type public.review_type,
  document_kind public.document_kind, document_version_id uuid, storage_path text,
  sha256 text, mime_type text, size_bytes bigint, attempts integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.analysis_runs;
begin
  for v_run in
    update public.analysis_runs a
    set status = 'failed', completed_at = now(),
        error = format('Analysis did not finish after %s attempts.', a.attempts)
    where a.engine = 'nj_contract_ai' and a.status = 'running'
      and a.started_at < now() - p_stale_after and a.attempts >= p_max_attempts
    returning a.*
  loop
    perform private.finish_review_analysis(v_run.review_id);
  end loop;

  select a.* into v_run
  from public.analysis_runs a
  join public.reviews r on r.id = a.review_id
  where a.engine = 'nj_contract_ai'
    and r.state = 'pending_analysis'
    and (a.status = 'queued'
         or (a.status = 'running' and a.started_at < now() - p_stale_after and a.attempts < p_max_attempts))
  order by a.created_at
  limit 1
  for update of a skip locked;

  if v_run.id is null then
    return;
  end if;

  update public.analysis_runs a
  set status = 'running', started_at = now(), attempts = a.attempts + 1,
      engine_version = p_engine_version
  where a.id = v_run.id;

  return query
    select a.id, a.org_id, a.review_id, r.review_type, d.kind, v.id, v.storage_path,
           v.sha256, v.mime_type, v.size_bytes, a.attempts
    from public.analysis_runs a
    join public.reviews r on r.id = a.review_id
    join public.document_versions v on v.id = r.document_version_id
    join public.documents d on d.id = v.document_id
    where a.id = v_run.id;
end;
$$;

create function public.complete_analysis_run(p_run uuid, p_result jsonb)
returns public.analysis_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.analysis_runs;
begin
  select * into v_run from public.analysis_runs where id = p_run for update;
  if v_run.id is null then
    raise exception 'analysis run not found' using errcode = 'P0002';
  end if;
  if v_run.engine <> 'nj_contract_ai' then
    raise exception 'only AI runs are completed by the worker' using errcode = '42501';
  end if;
  -- Structural checks; the worker validates the full schema before calling.
  if jsonb_typeof(p_result) <> 'object'
     or p_result ->> 'engine' is distinct from 'nj_contract_ai'
     or (p_result -> 'is_mock') is distinct from 'false'::jsonb
     or (p_result -> 'schema_version') is distinct from '1'::jsonb
     or p_result ->> 'engine_version' is distinct from v_run.engine_version
     or jsonb_typeof(p_result -> 'items') is distinct from 'array' then
    raise exception 'result does not match this run' using errcode = '22023';
  end if;
  update public.analysis_runs
  set status = 'completed', result = p_result, completed_at = now(), error = null
  where id = p_run
  returning * into v_run;
  perform private.finish_review_analysis(v_run.review_id);
  return v_run;
end;
$$;

create function public.fail_analysis_run(p_run uuid, p_error text)
returns public.analysis_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.analysis_runs;
begin
  select * into v_run from public.analysis_runs where id = p_run for update;
  if v_run.id is null then
    raise exception 'analysis run not found' using errcode = 'P0002';
  end if;
  if v_run.engine <> 'nj_contract_ai' then
    raise exception 'only AI runs are failed by the worker' using errcode = '42501';
  end if;
  update public.analysis_runs
  set status = 'failed', completed_at = now(),
      error = left(coalesce(nullif(trim(p_error), ''), 'Analysis failed.'), 500)
  where id = p_run
  returning * into v_run;
  perform private.finish_review_analysis(v_run.review_id);
  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.set_ai_review(uuid, boolean) from public, anon;
grant execute on function public.set_ai_review(uuid, boolean) to authenticated;

revoke all on function public.claim_analysis_run(text, interval, integer) from public, anon, authenticated;
revoke all on function public.complete_analysis_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_analysis_run(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_analysis_run(text, interval, integer) to service_role;
grant execute on function public.complete_analysis_run(uuid, jsonb) to service_role;
grant execute on function public.fail_analysis_run(uuid, text) to service_role;

revoke all on function private.finish_review_analysis(uuid) from public, anon, authenticated;
