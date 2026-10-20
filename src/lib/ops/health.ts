/**
 * Production health rules, kept pure so they can be unit tested. The script
 * scripts/health-check.ts gathers the inputs with the service role and exits
 * non-zero when any rule fails, which is what schedulers alert on.
 */
export type RunSnapshot = {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  engine: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type HealthReport = { ok: boolean; problems: string[]; notes: string[] };

export const DEFAULT_LIMITS = {
  /** A queued AI run older than this means the worker isn't picking work up. */
  queuedMinutes: 10,
  /** The worker reclaims runs after 15 minutes; older than this is stuck. */
  runningMinutes: 20,
  /** More failures than this in the last 24 hours needs a look. */
  failuresPerDay: 5,
};

const minutes = (ms: number) => Math.round(ms / 60000);

export function evaluateRuns(runs: RunSnapshot[], now: Date, limits = DEFAULT_LIMITS): HealthReport {
  const problems: string[] = [];
  const notes: string[] = [];
  const t = now.getTime();
  const ai = runs.filter((r) => r.engine !== "mock");

  const queued = ai.filter((r) => r.status === "queued");
  const oldestQueued = Math.max(0, ...queued.map((r) => t - Date.parse(r.created_at)));
  if (queued.length && oldestQueued > limits.queuedMinutes * 60000) {
    problems.push(
      `${queued.length} AI review(s) waiting; the oldest for ${minutes(oldestQueued)} min. Is the worker running?`,
    );
  }

  const stuck = ai.filter(
    (r) => r.status === "running" && r.started_at && t - Date.parse(r.started_at) > limits.runningMinutes * 60000,
  );
  if (stuck.length) problems.push(`${stuck.length} AI review(s) running for over ${limits.runningMinutes} min.`);

  const dayAgo = t - 24 * 3600000;
  const failed = ai.filter((r) => r.status === "failed" && r.completed_at && Date.parse(r.completed_at) > dayAgo);
  if (failed.length > limits.failuresPerDay) {
    problems.push(`${failed.length} AI reviews failed in the last 24 hours (limit ${limits.failuresPerDay}).`);
  }

  const done = ai.filter((r) => r.status === "completed" && r.completed_at && Date.parse(r.completed_at) > dayAgo);
  notes.push(`Last 24 h: ${done.length} completed, ${failed.length} failed; ${queued.length} queued now.`);
  return { ok: problems.length === 0, problems, notes };
}
