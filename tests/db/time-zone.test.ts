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

const zoneOf = async (org: string) =>
  (await db.admin.query<{ time_zone: string }>("select time_zone from public.organizations where id = $1", [org])).rows[0]
    .time_zone;

describe("a brokerage's time zone", () => {
  it("defaults to New Jersey's", async () => {
    expect(await zoneOf(s.alpha.org)).toBe("America/New_York");
    expect(await zoneOf(s.beta.org)).toBe("America/New_York");
  });

  it("only an admin of that brokerage can change it, with two-step sign-in", async () => {
    for (const user of [s.users.alphaBroker, s.users.alphaAgent, s.users.betaAdmin]) {
      const err = await expectDbError(
        runAs(db, user, "select public.set_org_time_zone($1, 'America/Chicago')", [s.alpha.org]),
      );
      expect(err.code).toBe("42501");
    }
    await expectDbError(
      runAs(db, s.users.alphaAdmin, "select public.set_org_time_zone($1, 'America/Chicago')", [s.alpha.org], {
        aal: "aal1",
      }),
    );
    expect(await zoneOf(s.alpha.org)).toBe("America/New_York");
  });

  it("clients cannot set the column directly", async () => {
    const err = await expectDbError(
      runAs(db, s.users.alphaAdmin, "update public.organizations set time_zone = 'UTC' where id = $1", [s.alpha.org]),
    );
    expect(err.code).toBe("42501");
  });

  it("rejects names that aren't a region/city time zone", async () => {
    for (const zone of ["Mars/Olympus_Mons", "EST", "UTC", "", "posix/America/Chicago"]) {
      const err = await expectDbError(
        runAs(db, s.users.alphaAdmin, "select public.set_org_time_zone($1, $2)", [s.alpha.org, zone]),
      );
      expect(err.code).toBe("22023");
    }
  });

  it("an admin changes it, and the old and new zones are audited", async () => {
    const { rows } = await runAs<{ time_zone: string }>(
      db,
      s.users.alphaAdmin,
      "select (public.set_org_time_zone($1, 'America/Chicago')).time_zone",
      [s.alpha.org],
      { commit: true },
    );
    expect(rows[0].time_zone).toBe("America/Chicago");
    expect(await zoneOf(s.beta.org)).toBe("America/New_York");
    const audit = await db.admin.query(
      "select actor_id, metadata from public.audit_log where org_id = $1 and action = 'organization.time_zone_changed'",
      [s.alpha.org],
    );
    expect(audit.rows).toEqual([
      { actor_id: s.users.alphaAdmin, metadata: { from: "America/New_York", to: "America/Chicago" } },
    ]);
  });
});

describe("advisor fixes", () => {
  it("every foreign key in public has a covering index", async () => {
    const { rows } = await db.admin.query(`
      select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
        )`);
    expect(rows).toEqual([]);
  });

  it("no public policy calls auth.uid() per row", async () => {
    const { rows } = await db.admin.query(`
      select tablename, policyname from pg_policies
      where schemaname = 'public'
        and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                           '\\(\\s*SELECT\\s+auth\\.uid\\(\\)\\s+AS\\s+uid\\s*\\)', '', 'gi') ~* 'auth\\.uid\\(\\)'`);
    expect(rows).toEqual([]);
  });

  it("agents still see only their own transactions", async () => {
    const { rows } = await runAs<{ id: string }>(db, s.users.alphaAgent, "select id from public.transactions");
    expect(rows.map((r) => r.id)).toEqual([s.alpha.txn]);
  });
});
