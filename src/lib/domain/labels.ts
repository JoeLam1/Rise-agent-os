import type {
  DocumentKind,
  OrgRole,
  ReviewState,
  ReviewType,
  TransactionSide,
  TransactionStatus,
} from "./types";

export const ROLE_LABELS: Record<OrgRole, string> = {
  agent: "Agent",
  broker: "Broker",
  admin: "Admin",
};

export const SIDE_LABELS: Record<TransactionSide, string> = {
  buyer: "Buyer",
  seller: "Seller",
  dual: "Dual agency",
  landlord: "Landlord",
  tenant: "Tenant",
};

export const STATUS_LABELS: Record<TransactionStatus, string> = {
  draft: "Draft",
  active: "Active",
  under_contract: "Under contract",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  purchase_agreement: "Purchase agreement",
  listing_agreement: "Listing agreement",
  addendum: "Addendum",
  disclosure: "Disclosure",
  lease: "Lease",
  other: "Other",
};

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  pre_signature: "Pre-signature",
  post_execution: "Post-execution",
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  pending_analysis: "Analyzing",
  ready_for_broker: "Awaiting broker",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const QUEUE_SLUGS = {
  "pre-signature": "pre_signature",
  "post-execution": "post_execution",
} as const satisfies Record<string, ReviewType>;

export type QueueSlug = keyof typeof QUEUE_SLUGS;

export function queueSlugFor(type: ReviewType): QueueSlug {
  return type === "pre_signature" ? "pre-signature" : "post-execution";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}
