import type { ReviewState } from "./types";

/** Mirrors private.review_transition_allowed in the database. */
export const REVIEW_TRANSITIONS: Record<ReviewState, readonly ReviewState[]> = {
  pending_analysis: ["ready_for_broker", "withdrawn"],
  ready_for_broker: ["approved", "changes_requested", "rejected", "withdrawn"],
  changes_requested: [],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export const DECISIONS = ["approved", "changes_requested", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

export function canTransition(from: ReviewState, to: ReviewState): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}

export function isOpenReview(state: ReviewState): boolean {
  return state === "pending_analysis" || state === "ready_for_broker";
}

export function decisionNeedsNote(decision: Decision): boolean {
  return decision !== "approved";
}
