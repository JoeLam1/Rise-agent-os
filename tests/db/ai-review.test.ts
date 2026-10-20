import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FAKE_SHA,
  createTestDatabase,
  expectDbError,
  putStorageObject,
  runAs,
  seedTwoTenants,
  type Db,
  type Seed,
} from "./harness";

let db: Db;
let s: Seed;

beforeAll(async () => {
  db = await createTestDatabase();
  s = await seedTwoTenants(db);
  await runAs(db, s.users.alphaAdmin, "select public.set_ai_review($1, true)", [s.alpha.org], { commit: true });
});
afterAll(async () => {
  await db?.close();
});

const ENGINE_VERSION = "nj-contract-ai-test";

const asWorker = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  runAs<T>(db, null, sql, params, { role: "service_role", commit: true });

/** A new Alpha version plus a review on it, requested by the Alpha agent. */
async function newAlphaReview(mime = "application/pdf") {
  const path = `${s.alpha.org}/${s.alpha.txn}/${s.alpha.doc}/${randomUUID()}.pdf`;
  await putStorageObject(db, s.users.alphaAgent, path, 1234);
  const version = (
    await runAs<{ id: string }>(
      db,
      s.users.alphaAgent,
      "select id from public.add_document_version($1, $2, $3, 1234, $4, 'contract.pdf')",
      [s.alpha.doc, path, FAKE_SHA, mime],
      { commit: true },
    )
  ).rows[0].id;
  const review = (
    await runAs<{ id: string; state: string }>(
      db,
      s.users.alphaAgent,
      "select id, state from public.request_review($1, 'pre_signature')",
      [version],
      { commit: true },
    )
  ).rows[0];
  return { version, review };
}

const claim = () =>
  asWorker<{ run_id: string; review_id: string; org_id: string; storage_path: string; attempts: number }>(
    "select * from public.claim_analysis_run($1)",
    [ENGINE_VERSION],
  );

const resultFor = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 1,
  engine: "nj_contract_ai",
  engine_version: ENGINE_VERSION,
  is_mock: false,
  review_type: "pre_signature",
  document_kind: "purchase_agreement",
  disclaimer: "Draft checklist (test).",
  summary: "Test summary.",
  items: [],
  ...overrides,
});

const reviewState = async (id: string) =>
  (await db.admin.query<{ state: string }>("select state from public.reviews where id = $1", [id])).rows[0].state;

/** Claims runs until the one for `reviewId` comes back; earlier ones are failed. */
async function claimFor(reviewId: string) {
  for (;;) {
    const { rows } = await claim();
    expect(rows.length).toBe(1);
    if (rows[0].review_id === reviewId) return rows[0];
    await asWorker("select public.fail_analysis_run($1, 'test cleanup')", [rows[0].run_id]);
  }
}

describe("turning AI review on", () => {
  it("only an admin of that brokerage can switch it", async () => {
    for (const user of [s.users.alphaBroker, s.users.alphaAgent, s.users.betaAdmin]) {
      const err = await expectDbError(runAs(db, user, "select public.set_ai_review($1, false)", [s.alpha.org]));
      expect(err.code).toBe("42501");
    }
  });

  it("clients cannot flip the column directly", async () => {
    const err = await expectDbError(
      runAs(db, s.users.alphaAdmin, "update public.organizations set ai_review_enabled = false where id = $1", [s.alpha.org]),
    );
    expect(err.code).toBe("42501");
  });

  it("the change is audited", async () => {
    const { rows } = await db.admin.query(
      "select actor_id from public.audit_log where org_id = $1 and action = 'organization.ai_review_enabled'",
      [s.alpha.org],
    );
    expect(rows).toEqual([{ actor_id: s.users.alphaAdmin }]);
  });
});

describe("requesting a review", () => {
  it("queues an AI run for a PDF and holds the review in pending_analysis", async () => {
    const { review } = await newAlphaReview();
    expect(review.state).toBe("pending_analysis");
    const { rows } = await db.admin.query("select engine, status, result from public.analysis_runs where review_id = $1", [
      review.id,
    ]);
    expect(rows).toEqual([{ engine: "nj_contract_ai", status: "queued", result: null }]);
  });

  it("falls back to the mock for a brokerage with AI off", async () => {
    const { rows } = await db.admin.query("select engine from public.analysis_runs where review_id = $1", [s.beta.review]);
    expect(rows).toEqual([{ engine: "mock" }]);
    expect(await reviewState(s.beta.review)).toBe("ready_for_broker");
  });

  it("falls back to the mock for files the engine can't read", async () => {
    const { review } = await newAlphaReview("image/png");
    expect(review.state).toBe("ready_for_broker");
    const { rows } = await db.admin.query("select engine from public.analysis_runs where review_id = $1", [review.id]);
    expect(rows).toEqual([{ engine: "mock" }]);
  });

  it("a broker cannot decide while analysis is still running", async () => {
    const { review } = await newAlphaReview();
    const err = await expectDbError(
      runAs(db, s.users.alphaBroker, "select public.decide_review($1, 'approved')", [review.id]),
    );
    expect(err.code).toBe("23514");
  });
});

describe("worker RPCs are service-only", () => {
  it("signed-in users and anonymous requests cannot claim, complete or fail runs", async () => {
    const { review } = await newAlphaReview();
    const runId = (await db.admin.query<{ id: string }>("select id from public.analysis_runs where review_id = $1", [review.id]))
      .rows[0].id;
    for (const user of [s.users.alphaAdmin, s.users.alphaBroker, s.users.betaAdmin, null]) {
      for (const [sql, params] of [
        ["select * from public.claim_analysis_run('x')", []],
        ["select public.complete_analysis_run($1, $2)", [runId, resultFor()]],
        ["select public.fail_analysis_run($1, 'x')", [runId]],
      ] as const) {
        const err = await expectDbError(runAs(db, user, sql, [...params]));
        expect(err.code).toBe("42501");
      }
    }
  });

  it("signed-in users cannot write analysis rows directly", async () => {
    const err = await expectDbError(
      runAs(db, s.users.alphaAdmin, "update public.analysis_runs set status = 'running' where org_id = $1", [s.alpha.org]),
    );
    expect(err.code).toBe("42501");
  });
});

describe("worker lifecycle", () => {
  it("claim -> complete moves the review to the broker with the AI result", async () => {
    const { review } = await newAlphaReview();
    const run = await claimFor(review.id);
    expect(run.org_id).toBe(s.alpha.org);
    expect(run.storage_path.startsWith(`${s.alpha.org}/`)).toBe(true);
    expect(run.attempts).toBe(1);

    await asWorker("select public.complete_analysis_run($1, $2)", [run.run_id, resultFor()]);
    expect(await reviewState(review.id)).toBe("ready_for_broker");

    const { rows } = await runAs(db, s.users.alphaBroker, "select engine, status, is_mock, engine_version from public.analysis_runs where id = $1", [
      run.run_id,
    ]);
    expect(rows).toEqual([{ engine: "nj_contract_ai", status: "completed", is_mock: false, engine_version: ENGINE_VERSION }]);

    await runAs(db, s.users.alphaBroker, "select public.decide_review($1, 'approved', 'Read it myself.')", [review.id], {
      commit: true,
    });
    expect(await reviewState(review.id)).toBe("approved");
  });

  it("a failed run still reaches the broker, who decides unaided", async () => {
    const { review } = await newAlphaReview();
    const run = await claimFor(review.id);
    await asWorker("select public.fail_analysis_run($1, 'Model unavailable (test).')", [run.run_id]);
    expect(await reviewState(review.id)).toBe("ready_for_broker");
    await runAs(db, s.users.alphaBroker, "select public.decide_review($1, 'changes_requested', 'Fix page 2.')", [review.id], {
      commit: true,
    });
    expect(await reviewState(review.id)).toBe("changes_requested");
  });

  it("refuses a result that claims to be mock, or comes from another engine version", async () => {
    const { review } = await newAlphaReview();
    const run = await claimFor(review.id);
    for (const bad of [
      resultFor({ is_mock: true }),
      resultFor({ engine: "mock" }),
      resultFor({ engine_version: "something-else" }),
      resultFor({ items: "nope" }),
    ]) {
      const err = await expectDbError(asWorker("select public.complete_analysis_run($1, $2)", [run.run_id, bad]));
      expect(err.code).toBe("22023");
    }
    await asWorker("select public.fail_analysis_run($1, 'test cleanup')", [run.run_id]);
  });

  it("finished runs are immutable, even for a superuser", async () => {
    const { review } = await newAlphaReview();
    const run = await claimFor(review.id);
    await asWorker("select public.complete_analysis_run($1, $2)", [run.run_id, resultFor()]);
    const again = await expectDbError(asWorker("select public.fail_analysis_run($1, 'late')", [run.run_id]));
    expect(again.code).toBe("42501");
    const direct = await expectDbError(
      db.admin.query("update public.analysis_runs set result = '{}'::jsonb where id = $1", [run.run_id]),
    );
    expect(direct.code).toBe("42501");
  });

  it("mock runs cannot be completed or failed by the worker", async () => {
    const mockRun = (await db.admin.query<{ id: string }>("select id from public.analysis_runs where review_id = $1", [s.beta.review]))
      .rows[0].id;
    const err = await expectDbError(asWorker("select public.fail_analysis_run($1, 'x')", [mockRun]));
    expect(err.code).toBe("42501");
  });

  it("a queued run cannot jump straight to completed", async () => {
    const { review } = await newAlphaReview();
    const runId = (await db.admin.query<{ id: string }>("select id from public.analysis_runs where review_id = $1", [review.id]))
      .rows[0].id;
    const err = await expectDbError(asWorker("select public.complete_analysis_run($1, $2)", [runId, resultFor({ engine_version: "pending" })]));
    expect(err.code).toBe("23514");
  });

  it("withdrawing a review cancels its queued run, and the worker skips it", async () => {
    const { review } = await newAlphaReview();
    await runAs(db, s.users.alphaAgent, "select public.withdraw_review($1)", [review.id], { commit: true });
    const { rows } = await db.admin.query("select status from public.analysis_runs where review_id = $1", [review.id]);
    expect(rows).toEqual([{ status: "failed" }]);
    // Drain the queue; the withdrawn review's run never comes back.
    for (;;) {
      const claimed = await claim();
      if (claimed.rows.length === 0) break;
      expect(claimed.rows[0].review_id).not.toBe(review.id);
      await asWorker("select public.fail_analysis_run($1, 'test cleanup')", [claimed.rows[0].run_id]);
    }
  });

  it("a crashed run is reclaimed, then failed after the attempt limit", async () => {
    const { review } = await newAlphaReview();
    const run = await claimFor(review.id);
    const again = await asWorker<{ run_id: string; attempts: number }>(
      "select * from public.claim_analysis_run($1, interval '0 seconds', 2)",
      [ENGINE_VERSION],
    );
    expect(again.rows).toEqual([expect.objectContaining({ run_id: run.run_id, attempts: 2 })]);
    const last = await asWorker("select * from public.claim_analysis_run($1, interval '0 seconds', 2)", [ENGINE_VERSION]);
    expect(last.rows).toEqual([]);
    const { rows } = await db.admin.query("select status, error from public.analysis_runs where id = $1", [run.run_id]);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toMatch(/2 attempts/);
    expect(await reviewState(review.id)).toBe("ready_for_broker");
  });

  it("Beta users never see Alpha's AI runs", async () => {
    const { rows } = await runAs(db, s.users.betaAdmin, "select count(*)::int as n from public.analysis_runs where org_id = $1", [
      s.alpha.org,
    ]);
    expect(rows[0].n).toBe(0);
  });
});
