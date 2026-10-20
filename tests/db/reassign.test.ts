import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, expectDbError, runAs, seedTwoTenants, type Db, type Seed } from "./harness";

let db: Db;
let s: Seed;
let secondTxn: string;

beforeAll(async () => {
  db = await createTestDatabase();
  s = await seedTwoTenants(db);
  secondTxn = (
    await runAs<{ id: string }>(
      db,
      s.users.alphaAgent,
      `insert into public.transactions (org_id, agent_id, property_address, side, status)
       values ($1, $2, '3 Placeholder Court, Sampletown, NJ', 'seller', 'closed') returning id`,
      [s.alpha.org, s.users.alphaAgent],
      { commit: true },
    )
  ).rows[0].id;
  const m = (
    await db.admin.query<{ id: string }>("select id from public.memberships where org_id = $1 and user_id = $2", [
      s.alpha.org,
      s.users.alphaAgent,
    ])
  ).rows[0].id;
  await runAs(db, s.users.alphaAdmin, "select public.remove_member($1)", [m], { commit: true });
});
afterAll(async () => {
  await db?.close();
});

const reassign = (actor: string, org: string, from: string, to: string, opts: { aal?: "aal1" | "aal2"; commit?: boolean } = {}) =>
  runAs<{ n: number }>(db, actor, "select public.reassign_transactions($1, $2, $3) as n", [org, from, to], opts);

describe("a removed agent's transactions", () => {
  it("can still be updated by a broker while unassigned", async () => {
    await runAs(db, s.users.alphaBroker, "update public.transactions set status = 'active' where id = $1", [s.alpha.txn]);
  });

  it("can't be handed to someone outside the brokerage, directly or by function", async () => {
    const direct = await expectDbError(
      runAs(db, s.users.alphaBroker, "update public.transactions set agent_id = $2 where id = $1", [s.alpha.txn, s.users.betaAgent]),
    );
    expect(direct.code).toBe("23514");
    expect((await expectDbError(reassign(s.users.alphaAdmin, s.alpha.org, s.users.alphaAgent, s.users.betaAgent))).code).toBe("23514");
  });

  it("are listed for brokers and admins of that brokerage only", async () => {
    const { rows } = await runAs<{ agent_id: string; email: string; open_count: number; total_count: number }>(
      db,
      s.users.alphaBroker,
      "select * from public.former_member_transactions($1)",
      [s.alpha.org],
    );
    expect(rows).toEqual([
      expect.objectContaining({ agent_id: s.users.alphaAgent, email: "agent1@alpha.test", open_count: 1, total_count: 2 }),
    ]);
    for (const actor of [s.users.alphaAgent2, s.users.betaAdmin]) {
      const err = await expectDbError(runAs(db, actor, "select * from public.former_member_transactions($1)", [s.alpha.org]));
      expect(err.code).toBe("42501");
    }
  });

  it("only a broker or admin of that brokerage, with two-step sign-in, can reassign them", async () => {
    for (const actor of [s.users.alphaAgent2, s.users.betaAdmin]) {
      expect((await expectDbError(reassign(actor, s.alpha.org, s.users.alphaAgent, s.users.alphaAgent2))).code).toBe("42501");
    }
    const aal1 = await expectDbError(reassign(s.users.alphaAdmin, s.alpha.org, s.users.alphaAgent, s.users.alphaAgent2, { aal: "aal1" }));
    expect(aal1.message).toMatch(/two-step/);
    const same = await expectDbError(reassign(s.users.alphaAdmin, s.alpha.org, s.users.alphaAgent2, s.users.alphaAgent2));
    expect(same.code).toBe("22023");
  });

  it("move, open and closed, to the new agent, with an audit entry each", async () => {
    const moved = await reassign(s.users.alphaAdmin, s.alpha.org, s.users.alphaAgent, s.users.alphaAgent2, { commit: true });
    expect(moved.rows[0].n).toBe(2);

    const seen = await runAs<{ id: string }>(db, s.users.alphaAgent2, "select id from public.transactions order by created_at");
    expect(seen.rows.map((r) => r.id).sort()).toEqual([s.alpha.txn, secondTxn].sort());

    const { rows } = await db.admin.query<{ from_agent: string; to_agent: string; actor: string }>(
      `select metadata->>'from_agent_id' as from_agent, metadata->>'to_agent_id' as to_agent, actor_id as actor
       from public.audit_log where org_id = $1 and action = 'transaction.reassigned'`,
      [s.alpha.org],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toEqual({ from_agent: s.users.alphaAgent, to_agent: s.users.alphaAgent2, actor: s.users.alphaAdmin });

    const left = await runAs(db, s.users.alphaAdmin, "select * from public.former_member_transactions($1)", [s.alpha.org]);
    expect(left.rows).toHaveLength(0);
  });

  it("other brokerages' transactions are untouched", async () => {
    const { rows } = await db.admin.query<{ agent_id: string }>("select agent_id from public.transactions where id = $1", [s.beta.txn]);
    expect(rows[0].agent_id).toBe(s.users.betaAgent);
  });
});
