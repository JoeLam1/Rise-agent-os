import { describe, expect, it } from "vitest";
import { evaluateRuns, type RunSnapshot } from "./health";

const now = new Date("2026-10-21T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
const run = (over: Partial<RunSnapshot>): RunSnapshot => ({
  status: "completed",
  engine: "nj_contract_ai",
  created_at: ago(5),
  started_at: ago(5),
  completed_at: ago(4),
  ...over,
});

describe("evaluateRuns", () => {
  it("is healthy with no runs", () => {
    expect(evaluateRuns([], now)).toMatchObject({ ok: true, problems: [] });
  });

  it("flags a queue the worker isn't draining, but not a fresh queue", () => {
    expect(evaluateRuns([run({ status: "queued", created_at: ago(3), started_at: null })], now).ok).toBe(true);
    const r = evaluateRuns([run({ status: "queued", created_at: ago(25), started_at: null })], now);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/oldest for 25 min/);
  });

  it("flags runs stuck in running", () => {
    expect(evaluateRuns([run({ status: "running", started_at: ago(45), completed_at: null })], now).ok).toBe(false);
    expect(evaluateRuns([run({ status: "running", started_at: ago(2), completed_at: null })], now).ok).toBe(true);
  });

  it("flags a burst of failures in the last day only", () => {
    const failures = (n: number, minAgo: number) =>
      Array.from({ length: n }, () => run({ status: "failed", completed_at: ago(minAgo) }));
    expect(evaluateRuns(failures(6, 60), now).ok).toBe(false);
    expect(evaluateRuns(failures(5, 60), now).ok).toBe(true);
    expect(evaluateRuns(failures(9, 60 * 30), now).ok).toBe(true);
  });

  it("ignores mock runs", () => {
    expect(evaluateRuns([run({ engine: "mock", status: "queued", created_at: ago(90) })], now).ok).toBe(true);
  });
});
