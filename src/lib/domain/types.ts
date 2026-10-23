// Row shapes for the tables in supabase/migrations. Kept by hand for Sprint
// 001; `npm run db:types` can generate the full Database type once a local
// Supabase stack is running.

export type OrgRole = "agent" | "broker" | "admin";
export type TransactionSide = "buyer" | "seller" | "dual" | "landlord" | "tenant";
export type TransactionStatus = "draft" | "active" | "under_contract" | "closed" | "cancelled";
export type DocumentKind =
  | "purchase_agreement"
  | "listing_agreement"
  | "addendum"
  | "disclosure"
  | "lease"
  | "other";
export type ReviewType = "pre_signature" | "post_execution";
export type ReviewState =
  | "pending_analysis"
  | "ready_for_broker"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "withdrawn";

export type KeyDateKind =
  | "attorney_review_end"
  | "inspection"
  | "mortgage_commitment"
  | "appraisal"
  | "closing"
  | "other";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  ai_review_enabled: boolean;
  created_at: string;
};

export type Membership = { id: string; org_id: string; user_id: string; role: OrgRole; created_at: string };

export type Profile = { id: string; email: string | null; full_name: string | null };

export type Transaction = {
  id: string;
  org_id: string;
  agent_id: string;
  property_address: string;
  property_city: string | null;
  property_state: string;
  side: TransactionSide;
  status: TransactionStatus;
  expected_close_date: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type DocumentRow = {
  id: string;
  org_id: string;
  transaction_id: string;
  title: string;
  kind: DocumentKind;
  created_by: string;
  created_at: string;
};

export type DocumentVersion = {
  id: string;
  org_id: string;
  document_id: string;
  version_number: number;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  original_filename: string;
  uploaded_by: string;
  created_at: string;
};

export type Review = {
  id: string;
  org_id: string;
  transaction_id: string;
  document_version_id: string;
  review_type: ReviewType;
  state: ReviewState;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type AnalysisRun = {
  id: string;
  review_id: string;
  engine: "mock" | "nj_contract_ai";
  engine_version: string;
  is_mock: boolean;
  status: "queued" | "running" | "completed" | "failed";
  result: unknown;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type AuditEntry = {
  id: number;
  org_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TransactionDate = {
  id: string;
  org_id: string;
  transaction_id: string;
  kind: KeyDateKind;
  label: string | null;
  due_on: string;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
