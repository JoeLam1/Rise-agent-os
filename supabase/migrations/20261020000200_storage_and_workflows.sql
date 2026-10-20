-- RISE Agent OS — Sprint 001 storage, document versioning and review workflow
--
-- State-changing operations that carry compliance meaning (new document
-- versions, review requests, broker decisions) go through these functions
-- rather than direct table writes. Clients have no INSERT/UPDATE privilege on
-- document_versions, reviews or analysis_runs.

-- ---------------------------------------------------------------------------
-- Private storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transaction-documents', 'transaction-documents', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

-- Read and create only. There are deliberately no UPDATE or DELETE policies,
-- so an uploaded object can't be overwritten or removed through the API.
create policy "rise_documents_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'transaction-documents' and private.can_access_storage_path(name));

create policy "rise_documents_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'transaction-documents' and private.can_access_storage_path(name));

-- ---------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------
create function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), auth.uid())
  returning * into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org.id, auth.uid(), 'admin');
  return v_org;
end;
$$;

create function public.add_org_member(p_org uuid, p_email text, p_role public.org_role)
returns public.memberships
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_membership public.memberships;
begin
  if not private.has_org_role(p_org, array['admin']::public.org_role[]) then
    raise exception 'only organization admins can add members' using errcode = '42501';
  end if;
  select p.id into v_user from public.profiles p where lower(p.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no account exists for that email' using errcode = 'P0002';
  end if;
  insert into public.memberships (org_id, user_id, role) values (p_org, v_user, p_role)
  returning * into v_membership;
  return v_membership;
end;
$$;

-- ---------------------------------------------------------------------------
-- Document versions
-- ---------------------------------------------------------------------------
-- Called after the file has been uploaded to storage with the caller's own
-- session. Confirms the object exists at the expected tenant path, then
-- records it as the next immutable version.
create function public.add_document_version(
  p_document uuid,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_mime_type text,
  p_original_filename text
) returns public.document_versions
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.documents;
  v_next integer;
  v_object_size bigint;
  v_version public.document_versions;
begin
  select * into v_doc from public.documents where id = p_document for update;
  if v_doc.id is null or not private.can_access_transaction(v_doc.transaction_id) then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  if p_storage_path not like v_doc.org_id || '/' || v_doc.transaction_id || '/' || v_doc.id || '/%'
     or array_length(string_to_array(p_storage_path, '/'), 1) <> 4 then
    raise exception 'storage path does not belong to this document' using errcode = '42501';
  end if;

  select coalesce((o.metadata ->> 'size')::bigint, p_size_bytes) into v_object_size
  from storage.objects o
  where o.bucket_id = 'transaction-documents' and o.name = p_storage_path;
  if not found then
    raise exception 'uploaded object not found in storage' using errcode = 'P0002';
  end if;
  if v_object_size <> p_size_bytes then
    raise exception 'size mismatch between upload and declared size' using errcode = '22023';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.document_versions where document_id = v_doc.id;

  insert into public.document_versions (
    org_id, document_id, version_number, storage_path, sha256, size_bytes,
    mime_type, original_filename, uploaded_by
  ) values (
    v_doc.org_id, v_doc.id, v_next, p_storage_path, lower(p_sha256), p_size_bytes,
    p_mime_type, p_original_filename, auth.uid()
  ) returning * into v_version;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review workflow
-- ---------------------------------------------------------------------------
-- Sprint 001 placeholder analysis. It does not read the document and makes no
-- findings: every item is "not_evaluated" so nothing can be mistaken for a
-- real review outcome. Sprint 002 replaces this with the NJ contract engine.
create function private.mock_analysis_result(p_type public.review_type, p_kind public.document_kind)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'schema_version', 1,
    'engine', 'mock',
    'engine_version', 'mock-0.1.0',
    'is_mock', true,
    'review_type', p_type,
    'document_kind', p_kind,
    'disclaimer', 'MOCK ANALYSIS. The document was not read. Nothing below is a finding, '
                  || 'legal advice, or an approval. A broker must review the document directly.',
    'summary', 'Placeholder checklist for broker review. All items are not evaluated.',
    'items', case p_type
      when 'pre_signature' then jsonb_build_array(
        jsonb_build_object('id', 'nj.attorney_review_clause', 'category', 'NJ requirements',
          'label', 'Attorney review clause present', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'nj.consumer_information_statement', 'category', 'NJ requirements',
          'label', 'Consumer Information Statement acknowledgment', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'core.parties_and_property', 'category', 'Core terms',
          'label', 'Parties, property address, block and lot', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'core.price_and_deposits', 'category', 'Core terms',
          'label', 'Purchase price, deposits and due dates', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'core.mortgage_contingency', 'category', 'Contingencies',
          'label', 'Mortgage contingency terms and commitment date', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'core.inspection_contingency', 'category', 'Contingencies',
          'label', 'Inspection contingency terms and deadlines', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'core.closing_date', 'category', 'Core terms',
          'label', 'Closing date', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'disclosure.lead_paint', 'category', 'Disclosures',
          'label', 'Lead-based paint disclosure (pre-1978 housing)', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'disclosure.seller_property_condition', 'category', 'Disclosures',
          'label', 'Seller property condition disclosure', 'status', 'not_evaluated')
      )
      else jsonb_build_array(
        jsonb_build_object('id', 'exec.signatures_complete', 'category', 'Execution',
          'label', 'All parties signed and dated', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'nj.attorney_review_period', 'category', 'NJ requirements',
          'label', 'Attorney review period start and end recorded', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'exec.deposit_receipt', 'category', 'Execution',
          'label', 'Deposit receipt documented', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'exec.deadlines_calendared', 'category', 'Execution',
          'label', 'Contingency deadlines calendared', 'status', 'not_evaluated'),
        jsonb_build_object('id', 'exec.changes_since_presignature', 'category', 'Execution',
          'label', 'Changes since pre-signature review identified', 'status', 'not_evaluated')
      )
    end
  );
$$;

create function public.request_review(p_document_version uuid, p_review_type public.review_type)
returns public.reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_version public.document_versions;
  v_doc public.documents;
  v_review public.reviews;
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

  -- Sprint 001: the mock engine completes synchronously.
  insert into public.analysis_runs (org_id, review_id, engine, engine_version, status, result, completed_at)
  values (v_doc.org_id, v_review.id, 'mock', 'mock-0.1.0', 'completed',
          private.mock_analysis_result(p_review_type, v_doc.kind), now());

  update public.reviews set state = 'ready_for_broker' where id = v_review.id
  returning * into v_review;
  return v_review;
end;
$$;

create function public.decide_review(p_review uuid, p_decision public.review_state, p_note text default null)
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
                 where a.review_id = v_review.id and a.status = 'completed') then
    raise exception 'review has no completed analysis' using errcode = '23514';
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

create function public.withdraw_review(p_review uuid)
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
  return v_review;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
revoke all on function public.add_org_member(uuid, text, public.org_role) from public, anon;
revoke all on function public.add_document_version(uuid, text, text, bigint, text, text) from public, anon;
revoke all on function public.request_review(uuid, public.review_type) from public, anon;
revoke all on function public.decide_review(uuid, public.review_state, text) from public, anon;
revoke all on function public.withdraw_review(uuid) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.add_org_member(uuid, text, public.org_role) to authenticated;
grant execute on function public.add_document_version(uuid, text, text, bigint, text, text) to authenticated;
grant execute on function public.request_review(uuid, public.review_type) to authenticated;
grant execute on function public.decide_review(uuid, public.review_state, text) to authenticated;
grant execute on function public.withdraw_review(uuid) to authenticated;

revoke all on function private.mock_analysis_result(public.review_type, public.document_kind) from public, anon, authenticated;
