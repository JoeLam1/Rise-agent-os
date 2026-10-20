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

const membershipId = async (org: string, user: string) =>
  (await db.admin.query<{ id: string }>("select id from public.memberships where org_id = $1 and user_id = $2", [org, user]))
    .rows[0]?.id;
const role = async (org: string, user: string) =>
  (await db.admin.query<{ role: string }>("select role from public.memberships where org_id = $1 and user_id = $2", [org, user]))
    .rows[0]?.role ?? null;
const setRole = (actor: string, membership: string, r: string, opts: { aal?: "aal1" | "aal2"; commit?: boolean } = {}) =>
  runAs(db, actor, "select public.set_member_role($1, $2::public.org_role)", [membership, r], opts);
const remove = (actor: string, membership: string, opts: { aal?: "aal1" | "aal2"; commit?: boolean } = {}) =>
  runAs(db, actor, "select public.remove_member($1)", [membership], opts);

describe("changing roles and removing members", () => {
  it("nobody can write memberships directly any more, admins included", async () => {
    const m = await membershipId(s.alpha.org, s.users.alphaAgent);
    for (const sql of [
      "update public.memberships set role = 'broker' where id = $1",
      "delete from public.memberships where id = $1",
    ]) {
      const err = await expectDbError(runAs(db, s.users.alphaAdmin, sql, [m]));
      expect(err.code, sql).toBe("42501");
    }
    const ins = await expectDbError(
      runAs(db, s.users.alphaAdmin, "insert into public.memberships (org_id, user_id, role) values ($1, $2, 'agent')", [
        s.alpha.org,
        s.users.betaAgent,
      ]),
    );
    expect(ins.code).toBe("42501");
  });

  it("only an admin of that brokerage, with two-step sign-in, can change a role", async () => {
    const m = await membershipId(s.alpha.org, s.users.alphaAgent);
    for (const actor of [s.users.alphaBroker, s.users.alphaAgent]) {
      expect((await expectDbError(setRole(actor, m, "admin"))).code).toBe("42501");
    }
    expect((await expectDbError(setRole(s.users.betaAdmin, m, "admin"))).code).toBe("P0002");
    expect((await expectDbError(setRole(s.users.alphaAdmin, m, "broker", { aal: "aal1" }))).message).toMatch(/two-step/);

    await setRole(s.users.alphaAdmin, m, "broker", { commit: true });
    expect(await role(s.alpha.org, s.users.alphaAgent)).toBe("broker");
    const { rows } = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where entity_id = $1 and action = 'membership.updated'",
      [m],
    );
    expect(rows[0].n).toBe(1);
    await setRole(s.users.alphaAdmin, m, "agent", { commit: true });
  });

  it("the last admin can't be demoted or removed", async () => {
    const admin = await membershipId(s.alpha.org, s.users.alphaAdmin);
    expect((await expectDbError(setRole(s.users.alphaAdmin, admin, "broker"))).code).toBe("23514");
    expect((await expectDbError(remove(s.users.alphaAdmin, admin))).code).toBe("23514");

    // With a second admin, the first can step down.
    const broker = await membershipId(s.alpha.org, s.users.alphaBroker);
    await setRole(s.users.alphaAdmin, broker, "admin", { commit: true });
    await setRole(s.users.alphaAdmin, admin, "broker", { commit: true });
    expect(await role(s.alpha.org, s.users.alphaAdmin)).toBe("broker");
    // Restore the seed's roles.
    await setRole(s.users.alphaBroker, admin, "admin", { commit: true });
    await setRole(s.users.alphaAdmin, broker, "broker", { commit: true });
  });

  it("a removed member loses access but their work stays with the brokerage", async () => {
    const m = await membershipId(s.alpha.org, s.users.alphaAgent);
    expect((await expectDbError(remove(s.users.alphaBroker, m))).code).toBe("42501");
    expect((await expectDbError(remove(s.users.betaAdmin, m))).code).toBe("P0002");
    expect((await expectDbError(remove(s.users.alphaAdmin, m, { aal: "aal1" }))).message).toMatch(/two-step/);

    await remove(s.users.alphaAdmin, m, { commit: true });
    expect(await role(s.alpha.org, s.users.alphaAgent)).toBeNull();
    const seen = await runAs(db, s.users.alphaAgent, "select count(*)::int as n from public.transactions where org_id = $1", [s.alpha.org]);
    expect(seen.rows[0].n).toBe(0);
    const kept = await runAs(db, s.users.alphaBroker, "select count(*)::int as n from public.transactions where id = $1", [s.alpha.txn]);
    expect(kept.rows[0].n).toBe(1);
    const { rows } = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where entity_id = $1 and action = 'membership.removed'",
      [m],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("two-step status for admins", () => {
  it("shows which members have an authenticator, to admins only", async () => {
    await db.admin.query("insert into auth.mfa_factors (user_id) values ($1)", [s.users.alphaBroker]);
    await db.admin.query("insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')", [s.users.alphaAgent2]);
    const { rows } = await runAs<{ user_id: string; two_step: boolean }>(
      db,
      s.users.alphaAdmin,
      "select * from public.member_two_step_status($1)",
      [s.alpha.org],
      { aal: "aal1" },
    );
    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r.two_step]));
    expect(byUser[s.users.alphaBroker]).toBe(true);
    expect(byUser[s.users.alphaAgent2]).toBe(false);
    expect(byUser[s.users.betaAdmin]).toBeUndefined();
    for (const actor of [s.users.alphaBroker, s.users.betaAdmin]) {
      const err = await expectDbError(runAs(db, actor, "select * from public.member_two_step_status($1)", [s.alpha.org]));
      expect(err.code).toBe("42501");
    }
  });

  it("signed-in users can't read Auth's factor list or the backup codes", async () => {
    for (const sql of ["select * from auth.mfa_factors", "select * from private.mfa_backup_codes"]) {
      const err = await expectDbError(runAs(db, s.users.alphaAdmin, sql));
      expect(err.code, sql).toBe("42501");
    }
  });
});

describe("backup codes", () => {
  const create = (user: string, aal: "aal1" | "aal2" = "aal2") =>
    runAs<{ codes: string[] }>(db, user, "select public.create_backup_codes() as codes", [], { commit: true, aal });
  const use = (user: string, code: string) =>
    runAs<{ ok: boolean }>(db, user, "select public.use_backup_code($1) as ok", [code], { commit: true, aal: "aal1" });
  const factors = async (user: string) =>
    (await db.admin.query<{ n: number }>("select count(*)::int as n from auth.mfa_factors where user_id = $1", [user])).rows[0].n;

  it("need a two-step session to create, and are stored only as hashes", async () => {
    expect((await expectDbError(create(s.users.betaBroker, "aal1"))).message).toMatch(/two-step/);
    const codes = (await create(s.users.betaBroker)).rows[0].codes;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    const { rows } = await db.admin.query<{ hash: string }>(
      "select encode(code_hash, 'hex') as hash from private.mfa_backup_codes where user_id = $1",
      [s.users.betaBroker],
    );
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(codes.join()).not.toContain(r.hash.slice(0, 8));
    const left = await runAs(db, s.users.betaBroker, "select public.backup_codes_remaining() as n", []);
    expect(left.rows[0].n).toBe(10);
  });

  it("a valid code removes the lost authenticator once; other codes stop working", async () => {
    await db.admin.query("insert into auth.mfa_factors (user_id) values ($1)", [s.users.betaAdmin]);
    const codes = (await create(s.users.betaAdmin)).rows[0].codes;
    expect((await use(s.users.betaAdmin, "0000-0000-0000")).rows[0].ok).toBe(false);
    expect(await factors(s.users.betaAdmin)).toBe(1);

    expect((await use(s.users.betaAdmin, codes[3].toUpperCase().replace(/-/g, " "))).rows[0].ok).toBe(true);
    expect(await factors(s.users.betaAdmin)).toBe(0);
    expect((await use(s.users.betaAdmin, codes[3])).rows[0].ok).toBe(false);
    expect((await use(s.users.betaAdmin, codes[4])).rows[0].ok).toBe(false);
    const { rows } = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where org_id = $1 and action = 'account.two_step_reset_with_backup_code'",
      [s.beta.org],
    );
    expect(rows[0].n).toBe(1);
  });

  it("someone else's code does nothing to your account", async () => {
    const theirs = (await create(s.users.betaBroker)).rows[0].codes;
    await db.admin.query("insert into auth.mfa_factors (user_id) values ($1)", [s.users.betaAgent]);
    expect((await use(s.users.betaAgent, theirs[0])).rows[0].ok).toBe(false);
    expect(await factors(s.users.betaAgent)).toBe(1);
  });

  it("locks after five wrong codes in 15 minutes", async () => {
    const codes = (await create(s.users.alphaAgent2)).rows[0].codes;
    for (let i = 0; i < 5; i += 1) await use(s.users.alphaAgent2, `bad-code-${i}`);
    const err = await expectDbError(use(s.users.alphaAgent2, codes[0]));
    expect(err.code).toBe("54000");
  });
});
