import type { OrgRole, Review } from "./types";

export function isBrokerOrAdmin(role: OrgRole): boolean {
  return role === "broker" || role === "admin";
}

export function dashboardPath(orgSlug: string, role: OrgRole): string {
  return `/o/${orgSlug}/dashboard/${isBrokerOrAdmin(role) ? "broker" : "agent"}`;
}

/**
 * UI mirror of public.decide_review's permission checks. The database is the
 * authority; this only decides whether to show the decision form.
 */
export function canDecideReview(
  role: OrgRole,
  userId: string,
  review: Pick<Review, "state" | "requested_by">,
): boolean {
  return isBrokerOrAdmin(role) && review.requested_by !== userId && review.state === "ready_for_broker";
}

export function canWithdrawReview(
  role: OrgRole,
  userId: string,
  review: Pick<Review, "state" | "requested_by">,
): boolean {
  const open = review.state === "pending_analysis" || review.state === "ready_for_broker";
  return open && (review.requested_by === userId || isBrokerOrAdmin(role));
}
