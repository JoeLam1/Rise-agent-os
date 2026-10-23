import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, expectDbError, runAs, seedTwoTenants, type Db, type Seed } from "./harness";

let db: Db;
let s: Seed;
let dateId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  s = await seedTwoTenants(db);
});
afterAll(async () => {
  await db?.close();
});

const insert = (actor: string, org: string, txn: string, kind = "inspection", label: string | null = null) =>
  runAs<{ id: string }>(
    db,
    actor,
    `insert into public.transaction_dates (org_id, transaction_id, kind, label, due_on)
     values ($1, $2, $3::public.key_date_kind, $4, '2027-04-10') returning id`,
    [org, txn, kind, label],
    { commit: true },
  );
const audit = async (action: string) =>
  (
    await db.admin.query<{ n: number }>("select count(*)::int as n from public.audit_log where entity_id = $1 and action = $2", [
      dateId,
      action,
    ])
  ).rows[0].n;

describe("key dates on a transaction", () => {
  it("the transaction's agent adds one, and it is audited", async () => {
    dateId = (await insert(s.users.alphaAgent, s.alpha.org, s.alpha.txn)).rows[0].id;
    expect(await audit("key_date.created")).toBe(1);
  });

  it("are visible to the agent and the brokerage's brokers, not to other agents or brokerages", async () => {
    const see = async (actor: string) =>
      (await runAs(db, actor, "select id from public.transaction_dates where id = $1", [dateId])).rows.length;
    expect(await see(s.users.alphaAgent)).toBe(1);
    expect(await see(s.users.alphaBroker)).toBe(1);
    expect(await see(s.users.alphaAdmin)).toBe(1);
    expect(await see(s.users.alphaAgent2)).toBe(0);
    expect(await see(s.users.betaAdmin)).toBe(0);
    expect((await runAs(db, null, "select id from public.transaction_dates").catch((e) => e)).code).toBe("42501");
  });

  it("can't be added to someone else's transaction or across brokerages", async () => {
    expect((await expectDbError(insert(s.users.alphaAgent2, s.alpha.org, s.alpha.txn))).code).toBe("42501");
    expect((await expectDbError(insert(s.users.betaAdmin, s.alpha.org, s.alpha.txn))).code).toBe("42501");
    // Beta's own org id with alpha's transaction fails the composite foreign key or the policy.
    const mixed = await expectDbError(insert(s.users.betaAdmin, s.beta.org, s.alpha.txn));
    expect(["42501", "23503"]).toContain(mixed.code);
  });

  it("'other' needs a label", async () => {
    expect((await expectDbError(insert(s.users.alphaAgent, s.alpha.org, s.alpha.txn, "other"))).code).toBe("23514");
    await insert(s.users.alphaAgent, s.alpha.org, s.alpha.txn, "other", "Survey due");
  });

  it("completion is stamped by the database with the real time and person", async () => {
    await runAs(
      db,
      s.users.alphaBroker,
      "update public.transaction_dates set completed_at = '2000-01-01', completed_by = $2 where id = $1",
      [dateId, s.users.alphaAgent],
      { commit: true },
    );
    const { rows } = await db.admin.query<{ by: string; recent: boolean }>(
      "select completed_by as by, completed_at > now() - interval '1 minute' as recent from public.transaction_dates where id = $1",
      [dateId],
    );
    expect(rows[0]).toEqual({ by: s.users.alphaBroker, recent: true });
    expect(await audit("key_date.completed")).toBe(1);

    await runAs(db, s.users.alphaAgent, "update public.transaction_dates set completed_at = null where id = $1", [dateId], {
      commit: true,
    });
    const reopened = await db.admin.query("select completed_by from public.transaction_dates where id = $1", [dateId]);
    expect(reopened.rows[0].completed_by).toBeNull();
    expect(await audit("key_date.reopened")).toBe(1);
  });

  it("can't be moved to another transaction or have its author rewritten", async () => {
    const other = (
      await runAs<{ id: string }>(
        db,
        s.users.alphaAgent,
        "insert into public.transactions (org_id, agent_id, property_address, side) values ($1, $2, '5 Sample Row, Sampletown, NJ', 'buyer') returning id",
        [s.alpha.org, s.users.alphaAgent],
        { commit: true },
      )
    ).rows[0].id;
    for (const [sql, param] of [
      ["update public.transaction_dates set transaction_id = $2 where id = $1", other],
      ["update public.transaction_dates set created_by = $2 where id = $1", s.users.alphaBroker],
    ]) {
      expect((await expectDbError(runAs(db, s.users.alphaAgent, sql, [dateId, param]))).code, sql).toBe("42501");
    }
  });

  it("a changed date records the old one, and deleting is audited", async () => {
    await runAs(db, s.users.alphaAgent, "update public.transaction_dates set due_on = '2027-04-12' where id = $1", [dateId], {
      commit: true,
    });
    const { rows } = await db.admin.query<{ from: string }>(
      "select metadata->>'from_due_on' as from from public.audit_log where entity_id = $1 and action = 'key_date.updated'",
      [dateId],
    );
    expect(rows.map((r) => r.from)).toContain("2027-04-10");

    expect((await runAs(db, s.users.alphaAgent2, "delete from public.transaction_dates where id = $1", [dateId])).rowCount).toBe(0);
    await runAs(db, s.users.alphaAgent, "delete from public.transaction_dates where id = $1", [dateId], { commit: true });
    expect(await audit("key_date.deleted")).toBe(1);
  });
});
