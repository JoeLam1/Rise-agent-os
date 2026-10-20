import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const aal1 = { aal: "aal1" as const };
const reviewState = async (id: string) =>
  (await db.admin.query<{ state: string }>("select state from public.reviews where id = $1", [id])).rows[0].state;

describe("two-step sign-in", () => {
  it("a broker signed in with a password only can't decide a review", async () => {
    const err = await expectDbError(
      runAs(db, s.users.alphaBroker, "select public.decide_review($1, 'approved')", [s.alpha.review], aal1),
    );
    expect(err.code).toBe("42501");
    expect(err.message).toMatch(/two-step sign-in/);
    expect(await reviewState(s.alpha.review)).toBe("ready_for_broker");
  });

  it("admin actions need it too", async () => {
    const calls: [string, unknown[]][] = [
      ["select public.set_ai_review($1, true)", [s.alpha.org]],
      ["select public.invite_member($1, 'someone@mfa.test', 'agent')", [s.alpha.org]],
      ["select public.add_org_member($1, 'someone@mfa.test', 'agent')", [s.alpha.org]],
    ];
    for (const [sql, params] of calls) {
      const err = await expectDbError(runAs(db, s.users.alphaAdmin, sql, params, aal1));
      expect(err.message, sql).toMatch(/two-step sign-in/);
    }
    await runAs(db, s.users.alphaAdmin, "select public.invite_member($1, 'revokable@mfa.test', 'agent')", [s.alpha.org], {
      commit: true,
    });
    const inv = (await db.admin.query<{ id: string }>("select id from public.invitations where email = 'revokable@mfa.test'")).rows[0].id;
    const err = await expectDbError(runAs(db, s.users.alphaAdmin, "select public.revoke_invitation($1)", [inv], aal1));
    expect(err.message).toMatch(/two-step sign-in/);
  });

  it("agents' everyday work doesn't need it", async () => {
    const { rows } = await runAs(
      db,
      s.users.alphaAgent,
      "select count(*)::int as n from public.transactions where org_id = $1",
      [s.alpha.org],
      aal1,
    );
    expect(rows[0].n).toBeGreaterThan(0);
    await runAs(db, s.users.alphaAgent, "select public.request_review($1, 'post_execution')", [s.alpha.version.id], aal1);
  });

  it("outsiders still get the normal refusal, not a hint about two-step sign-in", async () => {
    const err = await expectDbError(runAs(db, s.users.betaAdmin, "select public.decide_review($1, 'approved')", [s.alpha.review], aal1));
    expect(err.code).toBe("P0002");
  });

  it("the same broker can decide once the session has passed two-step sign-in", async () => {
    await runAs(db, s.users.alphaBroker, "select public.decide_review($1, 'approved')", [s.alpha.review], { commit: true, aal: "aal2" });
    expect(await reviewState(s.alpha.review)).toBe("approved");
  });
});
