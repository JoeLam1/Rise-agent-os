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

const invite = (user: string, org: string, email: string, role = "agent") =>
  runAs<{ result: string }>(db, user, "select public.invite_member($1, $2, $3::public.org_role) as result", [org, email, role], {
    commit: true,
  });

/** Stands in for Supabase Auth creating an account, confirmed or not. */
async function signUp(email: string, confirmed: boolean) {
  const { rows } = await db.admin.query<{ id: string }>(
    "insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id",
    [email, confirmed ? new Date() : null],
  );
  return rows[0].id;
}
const confirm = (id: string) => db.admin.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);

const membership = async (org: string, user: string) =>
  (await db.admin.query<{ role: string }>("select role from public.memberships where org_id = $1 and user_id = $2", [org, user]))
    .rows[0]?.role ?? null;

describe("inviting", () => {
  it("only an admin of that brokerage can invite", async () => {
    for (const user of [s.users.alphaBroker, s.users.alphaAgent, s.users.betaAdmin]) {
      const err = await expectDbError(invite(user, s.alpha.org, "someone@new.test"));
      expect(err.code).toBe("42501");
    }
  });

  it("adds an existing account straight away", async () => {
    const id = await signUp("existing@new.test", true);
    expect((await invite(s.users.alphaAdmin, s.alpha.org, "Existing@New.test", "broker")).rows[0].result).toBe("added");
    expect(await membership(s.alpha.org, id)).toBe("broker");
  });

  it("an unconfirmed account with that address gets an invitation, not a membership", async () => {
    const id = await signUp("pending@new.test", false);
    expect((await invite(s.users.alphaAdmin, s.alpha.org, "pending@new.test")).rows[0].result).toBe("invited");
    expect(await membership(s.alpha.org, id)).toBeNull();
    await confirm(id);
    expect(await membership(s.alpha.org, id)).toBe("agent");
  });

  it("stores an invitation for an unknown address, normalized", async () => {
    expect((await invite(s.users.alphaAdmin, s.alpha.org, "  Pat@Fresh.TEST ")).rows[0].result).toBe("invited");
    const { rows } = await runAs(db, s.users.alphaAdmin, "select email, role from public.invitations where org_id = $1 and email = 'pat@fresh.test'", [
      s.alpha.org,
    ]);
    expect(rows).toEqual([{ email: "pat@fresh.test", role: "agent" }]);
  });

  it("rejects malformed addresses", async () => {
    const err = await expectDbError(invite(s.users.alphaAdmin, s.alpha.org, "not-an-email"));
    expect(err.code).toBe("22023");
  });

  it("other brokerages and non-admins can't see invitations", async () => {
    for (const user of [s.users.betaAdmin, s.users.alphaBroker, s.users.alphaAgent]) {
      const { rows } = await runAs(db, user, "select count(*)::int as n from public.invitations where org_id = $1", [s.alpha.org]);
      expect(rows[0].n).toBe(0);
    }
  });

  it("clients can't write invitations directly", async () => {
    const err = await expectDbError(
      runAs(db, s.users.alphaAdmin, "insert into public.invitations (org_id, email, role, invited_by) values ($1, 'x@y.test', 'admin', $2)", [
        s.alpha.org,
        s.users.alphaAdmin,
      ]),
    );
    expect(err.code).toBe("42501");
  });
});

describe("accepting", () => {
  it("an unconfirmed sign-up with the invited address gets nothing until confirmed", async () => {
    await invite(s.users.alphaAdmin, s.alpha.org, "quinn@fresh.test", "broker");
    const id = await signUp("quinn@fresh.test", false);
    expect(await membership(s.alpha.org, id)).toBeNull();
    await confirm(id);
    expect(await membership(s.alpha.org, id)).toBe("broker");
    const { rows } = await db.admin.query("select accepted_by from public.invitations where email = 'quinn@fresh.test'");
    expect(rows).toEqual([{ accepted_by: id }]);
  });

  it("a confirmed sign-up joins every brokerage that invited it", async () => {
    await invite(s.users.alphaAdmin, s.alpha.org, "riley@fresh.test", "agent");
    await invite(s.users.betaAdmin, s.beta.org, "riley@fresh.test", "broker");
    const id = await signUp("Riley@Fresh.test", true);
    expect(await membership(s.alpha.org, id)).toBe("agent");
    expect(await membership(s.beta.org, id)).toBe("broker");
  });

  it("revoked and expired invitations are not accepted", async () => {
    await invite(s.users.alphaAdmin, s.alpha.org, "sam@fresh.test");
    const inv = (await db.admin.query<{ id: string }>("select id from public.invitations where email = 'sam@fresh.test'")).rows[0].id;
    await runAs(db, s.users.alphaAdmin, "select public.revoke_invitation($1)", [inv], { commit: true });
    expect(await membership(s.alpha.org, await signUp("sam@fresh.test", true))).toBeNull();

    await invite(s.users.alphaAdmin, s.alpha.org, "taylor@fresh.test");
    // Superuser back-dates it; the guard allows changing expiry on an open invitation.
    await db.admin.query("update public.invitations set expires_at = now() - interval '1 day' where email = 'taylor@fresh.test'");
    expect(await membership(s.alpha.org, await signUp("taylor@fresh.test", true))).toBeNull();
  });

  it("re-inviting replaces the open invitation with the new role", async () => {
    await invite(s.users.alphaAdmin, s.alpha.org, "uma@fresh.test", "agent");
    await invite(s.users.alphaAdmin, s.alpha.org, "uma@fresh.test", "broker");
    const id = await signUp("uma@fresh.test", true);
    expect(await membership(s.alpha.org, id)).toBe("broker");
  });

  it("another brokerage's admin can't revoke, and closed invitations can't change", async () => {
    await invite(s.users.alphaAdmin, s.alpha.org, "vic@fresh.test");
    const inv = (await db.admin.query<{ id: string }>("select id from public.invitations where email = 'vic@fresh.test'")).rows[0].id;
    const err = await expectDbError(runAs(db, s.users.betaAdmin, "select public.revoke_invitation($1)", [inv]));
    expect(err.code).toBe("P0002");
    await runAs(db, s.users.alphaAdmin, "select public.revoke_invitation($1)", [inv], { commit: true });
    const again = await expectDbError(db.admin.query("update public.invitations set expires_at = now() where id = $1", [inv]));
    expect(again.code).toBe("42501");
    const del = await expectDbError(db.admin.query("delete from public.invitations where id = $1", [inv]));
    expect(del.code).toBe("42501");
  });

  it("invitations are audited", async () => {
    const { rows } = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where org_id = $1 and action like 'invitation.%'",
      [s.alpha.org],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
