import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

export type Db = {
  admin: pg.Pool;
  close: () => Promise<void>;
};

/**
 * Creates a fresh database, loads the Supabase shim and every migration in
 * order. Each test file gets its own database so files can run in parallel.
 */
export async function createTestDatabase(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Run DB tests with `npm run test:db`.");
  }
  const dbName = `rise_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const bootstrap = new pg.Client({ connectionString: url });
  await bootstrap.connect();
  await bootstrap.query(`create database ${dbName}`);

  const dbUrl = new URL(url);
  dbUrl.pathname = `/${dbName}`;
  const admin = new pg.Pool({ connectionString: dbUrl.toString(), max: 4 });

  // Roles and their grants are cluster-wide, so parallel test files must not
  // run the shim and migrations at the same time.
  await bootstrap.query("select pg_advisory_lock(727001)");
  try {
    await admin.query(readFileSync(join(__dirname, "supabase-shim.sql"), "utf8"));
    const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of migrations) {
      await admin.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
  } finally {
    await bootstrap.query("select pg_advisory_unlock(727001)");
    await bootstrap.end();
  }

  return {
    admin,
    close: async () => {
      await admin.end();
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query(`drop database if exists ${dbName} with (force)`);
      await c.end();
    },
  };
}

type Role = "authenticated" | "anon" | "service_role";

/**
 * Runs SQL the way PostgREST does for a request: inside a transaction, with
 * the API role set and the JWT claims exposed to auth.uid().
 * Changes are rolled back unless `commit` is true.
 */
export async function runAs<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
  opts: { commit?: boolean; role?: Role } = {},
): Promise<pg.QueryResult<T>> {
  const role: Role = opts.role ?? (userId ? "authenticated" : "anon");
  const client = await db.admin.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    const result = await client.query<T>(sql, params);
    await client.query(opts.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Expects the statement to fail and returns the Postgres error. */
export async function expectDbError(promise: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof pg.DatabaseError) return err;
    throw err;
  }
  throw new Error("Expected the statement to fail, but it succeeded");
}

export async function createUser(db: Db, email: string, fullName: string): Promise<string> {
  const { rows } = await db.admin.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, { full_name: fullName }],
  );
  return rows[0].id;
}

/** Stands in for a file the Storage server has accepted. */
export async function putStorageObject(db: Db, userId: string, name: string, size: number) {
  return runAs(
    db,
    userId,
    "insert into storage.objects (bucket_id, name, metadata) values ('transaction-documents', $1, $2) returning id",
    [name, { size, mimetype: "application/pdf" }],
    { commit: true },
  );
}

export const FAKE_SHA = "a".repeat(64);

/**
 * Two fictional brokerages with the roles the tests need. Everything is
 * created through the same RLS-guarded paths the app uses.
 */
export async function seedTwoTenants(db: Db) {
  const u = {
    alphaAdmin: await createUser(db, "admin@alpha.test", "Alpha Admin"),
    alphaBroker: await createUser(db, "broker@alpha.test", "Alpha Broker"),
    alphaAgent: await createUser(db, "agent1@alpha.test", "Alpha Agent One"),
    alphaAgent2: await createUser(db, "agent2@alpha.test", "Alpha Agent Two"),
    betaAdmin: await createUser(db, "admin@beta.test", "Beta Admin"),
    betaBroker: await createUser(db, "broker@beta.test", "Beta Broker"),
    betaAgent: await createUser(db, "agent@beta.test", "Beta Agent"),
  };

  const alphaOrg = (
    await runAs<{ id: string }>(db, u.alphaAdmin, "select id from public.create_organization('Alpha Realty (test)', 'alpha-test')", [], { commit: true })
  ).rows[0].id;
  const betaOrg = (
    await runAs<{ id: string }>(db, u.betaAdmin, "select id from public.create_organization('Beta Homes (test)', 'beta-test')", [], { commit: true })
  ).rows[0].id;

  const add = (admin: string, org: string, email: string, role: string) =>
    runAs(db, admin, "select public.add_org_member($1, $2, $3::public.org_role)", [org, email, role], { commit: true });
  await add(u.alphaAdmin, alphaOrg, "broker@alpha.test", "broker");
  await add(u.alphaAdmin, alphaOrg, "agent1@alpha.test", "agent");
  await add(u.alphaAdmin, alphaOrg, "agent2@alpha.test", "agent");
  await add(u.betaAdmin, betaOrg, "broker@beta.test", "broker");
  await add(u.betaAdmin, betaOrg, "agent@beta.test", "agent");

  const makeTxn = async (agent: string, org: string, address: string) =>
    (
      await runAs<{ id: string }>(
        db,
        agent,
        `insert into public.transactions (org_id, agent_id, property_address, side, created_by)
         values ($1, $2, $3, 'buyer', $2) returning id`,
        [org, agent, address],
        { commit: true },
      )
    ).rows[0].id;
  const alphaTxn = await makeTxn(u.alphaAgent, alphaOrg, "1 Test Lane, Sampletown, NJ");
  const betaTxn = await makeTxn(u.betaAgent, betaOrg, "2 Example Road, Demoville, NJ");

  const makeDoc = async (agent: string, org: string, txn: string) =>
    (
      await runAs<{ id: string }>(
        db,
        agent,
        `insert into public.documents (org_id, transaction_id, title, kind, created_by)
         values ($1, $2, 'Purchase agreement (test)', 'purchase_agreement', $3) returning id`,
        [org, txn, agent],
        { commit: true },
      )
    ).rows[0].id;
  const alphaDoc = await makeDoc(u.alphaAgent, alphaOrg, alphaTxn);
  const betaDoc = await makeDoc(u.betaAgent, betaOrg, betaTxn);

  const makeVersion = async (agent: string, org: string, txn: string, doc: string) => {
    const path = `${org}/${txn}/${doc}/${randomUUID()}.pdf`;
    await putStorageObject(db, agent, path, 1234);
    const { rows } = await runAs<{ id: string; storage_path: string }>(
      db,
      agent,
      "select id, storage_path from public.add_document_version($1, $2, $3, 1234, 'application/pdf', 'contract.pdf')",
      [doc, path, FAKE_SHA],
      { commit: true },
    );
    return rows[0];
  };
  const alphaVersion = await makeVersion(u.alphaAgent, alphaOrg, alphaTxn, alphaDoc);
  const betaVersion = await makeVersion(u.betaAgent, betaOrg, betaTxn, betaDoc);

  const requestReview = async (agent: string, version: string) =>
    (
      await runAs<{ id: string }>(
        db,
        agent,
        "select id from public.request_review($1, 'pre_signature')",
        [version],
        { commit: true },
      )
    ).rows[0].id;
  const alphaReview = await requestReview(u.alphaAgent, alphaVersion.id);
  const betaReview = await requestReview(u.betaAgent, betaVersion.id);

  return {
    users: u,
    alpha: { org: alphaOrg, txn: alphaTxn, doc: alphaDoc, version: alphaVersion, review: alphaReview },
    beta: { org: betaOrg, txn: betaTxn, doc: betaDoc, version: betaVersion, review: betaReview },
  };
}

export type Seed = Awaited<ReturnType<typeof seedTwoTenants>>;
