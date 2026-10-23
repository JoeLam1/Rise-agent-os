import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type {
  AnalysisRun,
  AuditEntry,
  DocumentRow,
  DocumentVersion,
  Profile,
  Review,
  ReviewType,
  Transaction,
  TransactionDate,
  TransactionStatus,
} from "@/lib/domain/types";

// Every query runs with the user's session; RLS decides what comes back.
// The explicit org_id filters keep results scoped to the org in the URL for
// users who belong to more than one brokerage.

export async function listTransactions(
  supabase: ServerSupabase,
  orgId: string,
  opts: { agentId?: string; status?: TransactionStatus; limit?: number } = {},
): Promise<Transaction[]> {
  let q = supabase.from("transactions").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (opts.agentId) q = q.eq("agent_id", opts.agentId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load transactions: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export async function getTransaction(supabase: ServerSupabase, orgId: string, id: string) {
  const { data } = await supabase.from("transactions").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  return (data as Transaction | null) ?? null;
}

export async function listKeyDates(supabase: ServerSupabase, transactionId: string): Promise<TransactionDate[]> {
  const { data, error } = await supabase
    .from("transaction_dates")
    .select("*")
    .eq("transaction_id", transactionId)
    .order("due_on", { ascending: true });
  if (error) throw new Error(`Could not load key dates: ${error.message}`);
  return (data ?? []) as TransactionDate[];
}

export type UpcomingDate = TransactionDate & {
  transaction: Pick<Transaction, "id" | "property_address" | "agent_id" | "status"> | null;
};

/** Open key dates due on or before `through`, overdue ones included, on open transactions. */
export async function listUpcomingDates(
  supabase: ServerSupabase,
  orgId: string,
  through: string,
  opts: { agentId?: string } = {},
): Promise<UpcomingDate[]> {
  const { data, error } = await supabase
    .from("transaction_dates")
    .select("*, transaction:transactions(id, property_address, agent_id, status)")
    .eq("org_id", orgId)
    .is("completed_at", null)
    .lte("due_on", through)
    .order("due_on", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Could not load key dates: ${error.message}`);
  return ((data ?? []) as UpcomingDate[]).filter(
    (d) =>
      d.transaction &&
      d.transaction.status !== "closed" &&
      d.transaction.status !== "cancelled" &&
      (!opts.agentId || d.transaction.agent_id === opts.agentId),
  );
}

/** Reviews requested in the last `days` days or still open, for the turnaround figures. */
export async function listReviewTimes(supabase: ServerSupabase, orgId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("reviews")
    .select("state, requested_at, decided_at")
    .eq("org_id", orgId)
    .or(`decided_at.gte.${since},state.in.(ready_for_broker,pending_analysis)`);
  if (error) throw new Error(`Could not load review times: ${error.message}`);
  return (data ?? []) as Pick<Review, "state" | "requested_at" | "decided_at">[];
}

export type DocumentWithVersions = DocumentRow & { versions: DocumentVersion[] };

export async function listDocumentsWithVersions(
  supabase: ServerSupabase,
  transactionId: string,
): Promise<DocumentWithVersions[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("*, versions:document_versions(*)")
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load documents: ${error.message}`);
  return ((data ?? []) as DocumentWithVersions[]).map((d) => ({
    ...d,
    versions: [...d.versions].sort((a, b) => b.version_number - a.version_number),
  }));
}

export type ReviewListItem = Review & {
  transaction: Pick<Transaction, "id" | "property_address" | "agent_id"> | null;
  version: (Pick<DocumentVersion, "id" | "version_number" | "original_filename"> & {
    document: Pick<DocumentRow, "id" | "title" | "kind"> | null;
  }) | null;
};

const REVIEW_LIST_SELECT =
  "*, transaction:transactions(id, property_address, agent_id), version:document_versions(id, version_number, original_filename, document:documents(id, title, kind))";

export async function listReviews(
  supabase: ServerSupabase,
  orgId: string,
  opts: { type?: ReviewType; states?: Review["state"][]; transactionId?: string; requestedBy?: string; limit?: number } = {},
): Promise<ReviewListItem[]> {
  let q = supabase.from("reviews").select(REVIEW_LIST_SELECT).eq("org_id", orgId).order("requested_at", { ascending: true });
  if (opts.type) q = q.eq("review_type", opts.type);
  if (opts.states) q = q.in("state", opts.states);
  if (opts.transactionId) q = q.eq("transaction_id", opts.transactionId);
  if (opts.requestedBy) q = q.eq("requested_by", opts.requestedBy);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load reviews: ${error.message}`);
  return (data ?? []) as ReviewListItem[];
}

export async function listRecentDecisions(supabase: ServerSupabase, orgId: string, limit = 10) {
  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_LIST_SELECT)
    .eq("org_id", orgId)
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load decisions: ${error.message}`);
  return (data ?? []) as ReviewListItem[];
}

export async function getReview(supabase: ServerSupabase, orgId: string, id: string) {
  const { data } = await supabase
    .from("reviews")
    .select(
      "*, transaction:transactions(id, property_address, agent_id), version:document_versions(*, document:documents(id, title, kind))",
    )
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return data as
    | (Review & {
        transaction: Pick<Transaction, "id" | "property_address" | "agent_id"> | null;
        version: (DocumentVersion & { document: Pick<DocumentRow, "id" | "title" | "kind"> | null }) | null;
      })
    | null;
}

export type VersionWithDocument = DocumentVersion & {
  document: Pick<DocumentRow, "id" | "title" | "kind" | "transaction_id"> | null;
};

export async function getVersion(supabase: ServerSupabase, orgId: string, id: string) {
  const { data } = await supabase
    .from("document_versions")
    .select("*, document:documents(id, title, kind, transaction_id)")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data as VersionWithDocument | null) ?? null;
}

/**
 * The version a post-execution review should be compared with: the latest
 * approved pre-signature review in the same transaction, preferring one on
 * the same document.
 */
export async function findApprovedPreSignature(
  supabase: ServerSupabase,
  orgId: string,
  transactionId: string,
  documentId: string | undefined,
) {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, decided_at, decided_by, version:document_versions(id, version_number, document_id, document:documents(title))")
    .eq("org_id", orgId)
    .eq("transaction_id", transactionId)
    .eq("review_type", "pre_signature")
    .eq("state", "approved")
    .order("decided_at", { ascending: false });
  if (error) throw new Error(`Could not load pre-signature reviews: ${error.message}`);
  type Row = {
    id: string;
    decided_at: string;
    decided_by: string;
    version: { id: string; version_number: number; document_id: string; document: { title: string } | null } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.version);
  return rows.find((r) => r.version!.document_id === documentId) ?? rows[0] ?? null;
}

export async function listAnalysisRuns(supabase: ServerSupabase, reviewId: string): Promise<AnalysisRun[]> {
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load analysis: ${error.message}`);
  return (data ?? []) as AnalysisRun[];
}

export async function listAudit(
  supabase: ServerSupabase,
  orgId: string,
  opts: { entityIds?: string[]; limit?: number } = {},
): Promise<AuditEntry[]> {
  let q = supabase.from("audit_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (opts.entityIds) q = q.in("entity_id", opts.entityIds);
  q = q.limit(opts.limit ?? 100);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load audit log: ${error.message}`);
  return (data ?? []) as AuditEntry[];
}

export async function listMembers(supabase: ServerSupabase, orgId: string) {
  const { data, error } = await supabase
    .from("memberships")
    .select("id, role, user_id, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load members: ${error.message}`);
  const rows = (data ?? []) as { id: string; role: string; user_id: string; created_at: string }[];
  const profiles = await profilesById(
    supabase,
    rows.map((r) => r.user_id),
  );
  return rows.map((r) => ({ ...r, profile: profiles.get(r.user_id) ?? null }));
}

/** Who has an authenticator app set up. Admins only (the database checks). */
export async function memberTwoStepStatus(supabase: ServerSupabase, orgId: string): Promise<Map<string, boolean>> {
  const { data, error } = await supabase.rpc("member_two_step_status", { p_org: orgId });
  if (error) throw new Error(`Could not load two-step status: ${error.message}`);
  return new Map(((data ?? []) as { user_id: string; two_step: boolean }[]).map((r) => [r.user_id, r.two_step]));
}

export type FormerAgent = { agent_id: string; email: string | null; full_name: string | null; open_count: number; total_count: number };

/** Former members who still have transactions here. Brokers and admins only (the database checks). */
export async function formerMemberTransactions(supabase: ServerSupabase, orgId: string): Promise<FormerAgent[]> {
  const { data, error } = await supabase.rpc("former_member_transactions", { p_org: orgId });
  if (error) throw new Error(`Could not load former members' transactions: ${error.message}`);
  return (data ?? []) as FormerAgent[];
}

/** Names for display. Profiles are visible only for people who share an org. */
export async function profilesById(supabase: ServerSupabase, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const map = new Map<string, Profile>();
  if (unique.length === 0) return map;
  const { data } = await supabase.from("profiles").select("id, email, full_name").in("id", unique);
  for (const p of (data ?? []) as Profile[]) map.set(p.id, p);
  return map;
}

export function displayName(profile: Profile | null | undefined): string {
  return profile?.full_name || profile?.email || "Unknown user";
}

export type Invitation = { id: string; email: string; role: string; created_at: string; expires_at: string };

/** Open (not accepted, revoked or expired) invitations. Only admins can read these. */
export async function listOpenInvitations(supabase: ServerSupabase, orgId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role, created_at, expires_at")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load invitations: ${error.message}`);
  return (data ?? []) as Invitation[];
}
