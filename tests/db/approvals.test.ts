import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAnalysisResult } from "@/lib/analysis/schema";
import { createTestDatabase, expectDbError, runAs, seedTwoTenants, type Db, type Seed } from "./harness";

let db: Db;
let s: Seed;

beforeAll(async () => {
  db = await createTestDatabase();
  s = await seedTwoTenants(db);
});
afterAll(async () => {
  await db?.close();
});

const decide = (user: string, review: string, decision: string, note: string | null = null) =>
  runAs<{ state: string; decided_by: string }>(
    db,
    user,
    "select state, decided_by from public.decide_review($1, $2::public.review_state, $3)",
    [review, decision, note],
  );

describe("unauthorized approvals are refused", () => {
  it("an agent cannot approve, even their own review", async () => {
    const err = await expectDbError(decide(s.users.alphaAgent, s.alpha.review, "approved"));
    expect(err.code).toBe("42501");
  });

  it("another agent in the same brokerage cannot approve", async () => {
    const err = await expectDbError(decide(s.users.alphaAgent2, s.alpha.review, "approved"));
    expect(err.code).toBe("P0002");
  });

  it("a broker from another brokerage cannot approve", async () => {
    const err = await expectDbError(decide(s.users.betaBroker, s.alpha.review, "approved"));
    expect(err.code).toBe("P0002");
  });

  it("a broker cannot approve a review they requested", async () => {
    const { rows } = await runAs<{ id: string }>(
      db,
      s.users.alphaBroker,
      "select id from public.request_review($1, 'post_execution')",
      [s.alpha.version.id],
      { commit: true },
    );
    const err = await expectDbError(decide(s.users.alphaBroker, rows[0].id, "approved"));
    expect(err.code).toBe("42501");
    await runAs(db, s.users.alphaBroker, "select public.withdraw_review($1)", [rows[0].id], { commit: true });
  });

  it("nobody can set review state by writing the table directly", async () => {
    const update = await expectDbError(
      runAs(db, s.users.alphaBroker, "update public.reviews set state = 'approved' where id = $1", [s.alpha.review]),
    );
    expect(update.code).toBe("42501");
    const insert = await expectDbError(
      runAs(
        db,
        s.users.alphaBroker,
        `insert into public.reviews (org_id, transaction_id, document_version_id, review_type, state, requested_by, decided_by, decided_at)
         values ($1, $2, $3, 'pre_signature', 'approved', $4, $4, now())`,
        [s.alpha.org, s.alpha.txn, s.alpha.version.id, s.users.alphaBroker],
      ),
    );
    expect(insert.code).toBe("42501");
  });

  it("clients cannot plant analysis results that look like real AI output", async () => {
    const err = await expectDbError(
      runAs(
        db,
        s.users.alphaBroker,
        `insert into public.analysis_runs (org_id, review_id, engine, engine_version, status, result)
         values ($1, $2, 'nj_contract_ai', 'fake', 'completed', '{}'::jsonb)`,
        [s.alpha.org, s.alpha.review],
      ),
    );
    expect(err.code).toBe("42501");
  });

  it("requesting changes or rejecting requires a note", async () => {
    for (const decision of ["changes_requested", "rejected"]) {
      const err = await expectDbError(decide(s.users.alphaBroker, s.alpha.review, decision, "  "));
      expect(err.code).toBe("22023");
    }
  });

  it("decide_review only accepts decision states", async () => {
    const err = await expectDbError(decide(s.users.alphaBroker, s.alpha.review, "ready_for_broker"));
    expect(err.code).toBe("22023");
  });
});

describe("authorized decisions", () => {
  it("a broker in the same brokerage can approve, once, and it is audited", async () => {
    const { rows } = await runAs<{ state: string; decided_by: string }>(
      db,
      s.users.alphaBroker,
      "select state, decided_by from public.decide_review($1, 'approved', 'Reviewed v1 directly.')",
      [s.alpha.review],
      { commit: true },
    );
    expect(rows[0]).toEqual({ state: "approved", decided_by: s.users.alphaBroker });

    const again = await expectDbError(decide(s.users.alphaAdmin, s.alpha.review, "rejected", "changed my mind"));
    expect(again.code).toBe("23514");

    const audit = await runAs<{ actor_id: string; metadata: { from_state: string; note: string } }>(
      db,
      s.users.alphaBroker,
      "select actor_id, metadata from public.audit_log where action = 'review.approved' and entity_id = $1",
      [s.alpha.review],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(s.users.alphaBroker);
    expect(audit.rows[0].metadata.from_state).toBe("ready_for_broker");
    expect(audit.rows[0].metadata.note).toBe("Reviewed v1 directly.");
  });

  it("the state machine holds even for a superuser writing directly", async () => {
    const back = await expectDbError(
      db.admin.query("update public.reviews set state = 'ready_for_broker', decided_by = null, decided_at = null where id = $1", [
        s.alpha.review,
      ]),
    );
    expect(back.code).toBe("23514");
    const rewrite = await expectDbError(
      db.admin.query("update public.reviews set decision_note = 'edited later' where id = $1", [s.alpha.review]),
    );
    expect(rewrite.code).toBe("42501");
  });

  it("only one open review of each type per document version", async () => {
    const err = await expectDbError(
      runAs(db, s.users.betaAgent, "select public.request_review($1, 'pre_signature')", [s.beta.version.id]),
    );
    expect(err.code).toBe("23505");
  });
});

describe("mock analysis", () => {
  it("is labelled mock, evaluates nothing and parses with the app schema", async () => {
    const { rows } = await runAs<{ engine: string; is_mock: boolean; result: unknown }>(
      db,
      s.users.betaBroker,
      "select engine, is_mock, result from public.analysis_runs where review_id = $1",
      [s.beta.review],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].engine).toBe("mock");
    expect(rows[0].is_mock).toBe(true);
    const parsed = parseAnalysisResult(rows[0].result);
    expect(parsed).not.toBeNull();
    expect(parsed!.disclaimer).toMatch(/^MOCK ANALYSIS/);
    expect(parsed!.items.length).toBeGreaterThan(0);
    expect(parsed!.items.every((i) => i.status === "not_evaluated")).toBe(true);
  });
});
