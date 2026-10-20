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

const count = async (user: string | null, table: string, where = "true", params: unknown[] = []) =>
  Number(
    (await runAs<{ n: string }>(db, user, `select count(*) as n from ${table} where ${where}`, params)).rows[0].n,
  );

describe("cross-tenant reads", () => {
  const tables = [
    ["public.transactions", "org_id"],
    ["public.documents", "org_id"],
    ["public.document_versions", "org_id"],
    ["public.reviews", "org_id"],
    ["public.analysis_runs", "org_id"],
    ["public.audit_log", "org_id"],
    ["public.memberships", "org_id"],
    ["public.organizations", "id"],
  ] as const;

  for (const [table, orgCol] of tables) {
    it(`Beta broker sees no Alpha rows in ${table}`, async () => {
      expect(await count(s.users.betaBroker, table, `${orgCol} = $1`, [s.alpha.org])).toBe(0);
      expect(await count(s.users.betaBroker, table, `${orgCol} = $1`, [s.beta.org])).toBeGreaterThan(0);
    });
  }

  it("Alpha admin cannot see Beta profiles", async () => {
    expect(await count(s.users.alphaAdmin, "public.profiles", "id = $1", [s.users.betaAgent])).toBe(0);
    expect(await count(s.users.alphaAdmin, "public.profiles", "id = $1", [s.users.alphaAgent])).toBe(1);
  });

  it("anonymous requests read nothing", async () => {
    for (const table of ["public.transactions", "public.documents", "public.reviews", "public.organizations"]) {
      const err = await expectDbError(runAs(db, null, `select * from ${table}`));
      expect(err.code).toBe("42501");
    }
  });
});

describe("cross-tenant writes", () => {
  it("Beta broker cannot create a transaction in Alpha", async () => {
    const err = await expectDbError(
      runAs(
        db,
        s.users.betaBroker,
        `insert into public.transactions (org_id, agent_id, property_address, side, created_by)
         values ($1, $2, '9 Nowhere St', 'buyer', $2)`,
        [s.alpha.org, s.users.betaBroker],
      ),
    );
    // The membership trigger runs before the RLS check; either refusal is fine.
    expect(["42501", "23514"]).toContain(err.code);
  });

  it("an Alpha transaction cannot be assigned to an agent from Beta", async () => {
    const err = await expectDbError(
      runAs(
        db,
        s.users.alphaBroker,
        `insert into public.transactions (org_id, agent_id, property_address, side, created_by)
         values ($1, $2, '9 Nowhere St', 'buyer', $3)`,
        [s.alpha.org, s.users.betaAgent, s.users.alphaBroker],
      ),
    );
    expect(err.code).toBe("23514");
  });

  it("Beta agent cannot attach a document to an Alpha transaction", async () => {
    for (const org of [s.alpha.org, s.beta.org]) {
      await expectDbError(
        runAs(
          db,
          s.users.betaAgent,
          `insert into public.documents (org_id, transaction_id, title, created_by) values ($1, $2, 'x', $3)`,
          [org, s.alpha.txn, s.users.betaAgent],
        ),
      );
    }
  });

  it("Beta broker cannot update or move an Alpha transaction", async () => {
    const res = await runAs(db, s.users.betaBroker, "update public.transactions set status = 'cancelled' where id = $1", [
      s.alpha.txn,
    ]);
    expect(res.rowCount).toBe(0);
    const err = await expectDbError(
      runAs(db, s.users.alphaBroker, "update public.transactions set org_id = $1 where id = $2", [s.beta.org, s.alpha.txn]),
    );
    expect(err.code).toBe("42501");
  });

  it("Beta admin cannot add members to Alpha", async () => {
    const direct = await expectDbError(
      runAs(db, s.users.betaAdmin, "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin')", [
        s.alpha.org,
        s.users.betaAdmin,
      ]),
    );
    expect(direct.code).toBe("42501");
    const rpc = await expectDbError(
      runAs(db, s.users.betaAdmin, "select public.add_org_member($1, 'admin@beta.test', 'admin')", [s.alpha.org]),
    );
    expect(rpc.code).toBe("42501");
  });

  it("an agent cannot promote themselves", async () => {
    const direct = await expectDbError(
      runAs(db, s.users.alphaAgent, "update public.memberships set role = 'admin' where user_id = $1", [s.users.alphaAgent]),
    );
    expect(direct.code).toBe("42501");
    const err = await expectDbError(
      runAs(db, s.users.alphaAgent, "select public.add_org_member($1, 'agent1@alpha.test', 'admin')", [s.alpha.org]),
    );
    expect(err.code).toBe("42501");
  });

  it("clients cannot write the audit log", async () => {
    const err = await expectDbError(
      runAs(
        db,
        s.users.alphaAdmin,
        "insert into public.audit_log (org_id, actor_id, action, entity_type) values ($1, $2, 'fake', 'x')",
        [s.alpha.org, s.users.alphaAdmin],
      ),
    );
    expect(err.code).toBe("42501");
  });
});

describe("role scoping inside one brokerage", () => {
  it("an agent only sees their own transactions and documents", async () => {
    expect(await count(s.users.alphaAgent2, "public.transactions", "id = $1", [s.alpha.txn])).toBe(0);
    expect(await count(s.users.alphaAgent2, "public.documents", "id = $1", [s.alpha.doc])).toBe(0);
    expect(await count(s.users.alphaAgent2, "public.document_versions", "id = $1", [s.alpha.version.id])).toBe(0);
    expect(await count(s.users.alphaAgent2, "public.reviews", "id = $1", [s.alpha.review])).toBe(0);
    expect(await count(s.users.alphaAgent, "public.transactions", "id = $1", [s.alpha.txn])).toBe(1);
  });

  it("brokers see every transaction in their brokerage", async () => {
    expect(await count(s.users.alphaBroker, "public.transactions", "id = $1", [s.alpha.txn])).toBe(1);
    expect(await count(s.users.alphaBroker, "public.reviews", "id = $1", [s.alpha.review])).toBe(1);
  });

  it("agents cannot read the audit log; brokers can", async () => {
    expect(await count(s.users.alphaAgent, "public.audit_log")).toBe(0);
    expect(await count(s.users.alphaBroker, "public.audit_log")).toBeGreaterThan(0);
  });

  it("an agent cannot create a transaction for another agent", async () => {
    const err = await expectDbError(
      runAs(
        db,
        s.users.alphaAgent,
        `insert into public.transactions (org_id, agent_id, property_address, side, created_by)
         values ($1, $2, '3 Other St', 'seller', $3)`,
        [s.alpha.org, s.users.alphaAgent2, s.users.alphaAgent],
      ),
    );
    expect(err.code).toBe("42501");
  });

  it("an agent cannot request a review on another agent's document", async () => {
    const err = await expectDbError(
      runAs(db, s.users.alphaAgent2, "select public.request_review($1, 'post_execution')", [s.alpha.version.id]),
    );
    expect(err.code).toBe("P0002");
  });
});
