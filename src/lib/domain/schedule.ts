import type { KeyDateKind, Review } from "./types";

/** Brokerages are in New Jersey for the pilot; "today" is their calendar day. */
export const BROKERAGE_TIME_ZONE = "America/New_York";
/** How far ahead dashboards look for key dates. */
export const UPCOMING_DAYS = 14;

/** Today's date as YYYY-MM-DD in the brokerage's time zone. */
export function localToday(now = new Date(), timeZone = BROKERAGE_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative when past. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type DueState = { kind: "done" | "overdue" | "today" | "soon" | "later"; days: number; label: string };

/** Describes a key date relative to today. It reports the date people entered; it never computes a deadline. */
export function dueState(dueOn: string, completed: boolean, today: string): DueState {
  const days = daysBetween(today, dueOn);
  if (completed) return { kind: "done", days, label: "Done" };
  if (days < 0) return { kind: "overdue", days, label: `Overdue by ${-days} day${days === -1 ? "" : "s"}` };
  if (days === 0) return { kind: "today", days, label: "Due today" };
  return { kind: days <= UPCOMING_DAYS ? "soon" : "later", days, label: `In ${days} day${days === 1 ? "" : "s"}` };
}

export const KEY_DATE_LABELS: Record<KeyDateKind, string> = {
  attorney_review_end: "Attorney review ends",
  inspection: "Inspection",
  mortgage_commitment: "Mortgage commitment",
  appraisal: "Appraisal",
  closing: "Closing",
  other: "Other",
};

export type Turnaround = {
  /** Reviews decided in the window (approved, rejected or changes requested). */
  decided: number;
  medianHours: number | null;
  /** Reviews waiting on a broker now, and how long the oldest has waited. */
  waiting: number;
  oldestWaitingHours: number | null;
};

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Time from a review request to the broker's decision, the pilot's success
 * measure in docs/PRD.md. Withdrawn reviews are left out: nobody decided them.
 */
export function turnaround(
  reviews: Pick<Review, "state" | "requested_at" | "decided_at">[],
  now = new Date(),
  windowDays = 30,
): Turnaround {
  const since = now.getTime() - windowDays * 86_400_000;
  const hours = (from: string, to: number) => (to - Date.parse(from)) / 3_600_000;
  const decided = reviews.filter(
    (r) => r.decided_at && r.state !== "withdrawn" && Date.parse(r.decided_at) >= since,
  );
  const waiting = reviews.filter((r) => r.state === "ready_for_broker" || r.state === "pending_analysis");
  return {
    decided: decided.length,
    medianHours: median(decided.map((r) => hours(r.requested_at, Date.parse(r.decided_at!)))),
    waiting: waiting.length,
    oldestWaitingHours: waiting.length ? Math.max(...waiting.map((r) => hours(r.requested_at, now.getTime()))) : null,
  };
}

export function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}
