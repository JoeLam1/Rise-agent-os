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
});
afterAll(async () => {
  await db?.close();
});

const alphaPath = () => `${s.alpha.org}/${s.alpha.txn}/${s.alpha.doc}/${randomUUID()}.pdf`;

const addVersion = (user: string, doc: string, path: string, size = 1234) =>
  runAs<{ version_number: number }>(
    db,
    user,
    "select version_number from public.add_document_version($1, $2, $3, $4, 'application/pdf', 'contract.pdf')",
    [doc, path, FAKE_SHA, size],
    { commit: true },
  );

describe("immutable versions", () => {
  it("a new upload becomes the next version and earlier versions remain", async () => {
    const path = alphaPath();
    await putStorageObject(db, s.users.alphaAgent, path, 1234);
    const { rows } = await addVersion(s.users.alphaAgent, s.alpha.doc, path);
    expect(rows[0].version_number).toBe(2);

    const all = await runAs<{ version_number: number }>(
      db,
      s.users.alphaAgent,
      "select version_number from public.document_versions where document_id = $1 order by 1",
      [s.alpha.doc],
    );
    expect(all.rows.map((r) => r.version_number)).toEqual([1, 2]);
  });

  it("versions cannot be updated or deleted, even by a superuser", async () => {
    const upd = await expectDbError(
      db.admin.query("update public.document_versions set sha256 = $1 where id = $2", ["b".repeat(64), s.alpha.version.id]),
    );
    expect(upd.code).toBe("42501");
    const del = await expectDbError(db.admin.query("delete from public.document_versions where id = $1", [s.alpha.version.id]));
    expect(del.code).toBe("42501");
  });

  it("clients cannot insert version rows directly", async () => {
    const err = await expectDbError(
      runAs(
        db,
        s.users.alphaAgent,
        `insert into public.document_versions (org_id, document_id, version_number, storage_path, sha256, size_bytes, mime_type, original_filename, uploaded_by)
         values ($1, $2, 99, $3, $4, 1, 'application/pdf', 'x.pdf', $5)`,
        [s.alpha.org, s.alpha.doc, alphaPath(), FAKE_SHA, s.users.alphaAgent],
      ),
    );
    expect(err.code).toBe("42501");
  });

  it("documents cannot be deleted and cannot move to another transaction", async () => {
    const del = await expectDbError(db.admin.query("delete from public.documents where id = $1", [s.alpha.doc]));
    expect(del.code).toBe("42501");
    const move = await expectDbError(
      runAs(db, s.users.alphaBroker, "update public.documents set transaction_id = $1 where id = $2", [s.beta.txn, s.alpha.doc]),
    );
    expect(["42501", "23503"]).toContain(move.code);
  });

  it("the audit log is append-only, even for a superuser", async () => {
    const upd = await expectDbError(db.admin.query("update public.audit_log set action = 'x'"));
    expect(upd.code).toBe("42501");
    const del = await expectDbError(db.admin.query("delete from public.audit_log"));
    expect(del.code).toBe("42501");
  });
});

describe("registering a version", () => {
  it("refuses a path outside the document's own folder", async () => {
    const foreign = `${s.beta.org}/${s.beta.txn}/${s.beta.doc}/${randomUUID()}.pdf`;
    const err = await expectDbError(addVersion(s.users.alphaAgent, s.alpha.doc, foreign));
    expect(err.code).toBe("42501");
  });

  it("refuses when nothing was uploaded", async () => {
    const err = await expectDbError(addVersion(s.users.alphaAgent, s.alpha.doc, alphaPath()));
    expect(err.code).toBe("P0002");
  });

  it("refuses a declared size that does not match the stored object", async () => {
    const path = alphaPath();
    await putStorageObject(db, s.users.alphaAgent, path, 500);
    const err = await expectDbError(addVersion(s.users.alphaAgent, s.alpha.doc, path, 1234));
    expect(err.code).toBe("22023");
  });

  it("refuses users from another brokerage", async () => {
    const err = await expectDbError(addVersion(s.users.betaBroker, s.alpha.doc, alphaPath()));
    expect(err.code).toBe("P0002");
  });
});

describe("private storage", () => {
  const objectCount = async (user: string, name: string) =>
    Number(
      (
        await runAs<{ n: string }>(db, user, "select count(*) as n from storage.objects where name = $1", [name])
      ).rows[0].n,
    );

  it("files are only readable by people who can see the transaction", async () => {
    const path = s.alpha.version.storage_path;
    expect(await objectCount(s.users.alphaAgent, path)).toBe(1);
    expect(await objectCount(s.users.alphaBroker, path)).toBe(1);
    expect(await objectCount(s.users.alphaAgent2, path)).toBe(0);
    expect(await objectCount(s.users.betaBroker, path)).toBe(0);
    expect(await objectCount(s.users.betaAdmin, path)).toBe(0);
  });

  it("nobody can upload into another brokerage's folder", async () => {
    const err = await expectDbError(putStorageObject(db, s.users.betaBroker, alphaPath(), 10));
    expect(err.code).toBe("42501");
  });

  it("malformed or guessed paths are refused", async () => {
    const bad = [
      `${s.alpha.org}/${s.alpha.txn}/${s.alpha.doc}`,
      `${s.alpha.org}/${s.alpha.txn}/${s.alpha.doc}/a/b.pdf`,
      `${s.alpha.org}/not-a-uuid/${s.alpha.doc}/x.pdf`,
      `${s.alpha.org}/${s.beta.txn}/${s.alpha.doc}/x.pdf`,
      `${s.beta.org}/${s.alpha.txn}/${s.alpha.doc}/x.pdf`,
    ];
    for (const name of bad) {
      const err = await expectDbError(putStorageObject(db, s.users.alphaAgent, name, 10));
      expect(err.code).toBe("42501");
    }
  });

  it("stored files cannot be overwritten or deleted through the API", async () => {
    const path = s.alpha.version.storage_path;
    const upd = await runAs(db, s.users.alphaAgent, "update storage.objects set metadata = '{}' where name = $1", [path]);
    expect(upd.rowCount).toBe(0);
    const del = await runAs(db, s.users.alphaBroker, "delete from storage.objects where name = $1", [path]);
    expect(del.rowCount).toBe(0);
  });

  it("the bucket is private", async () => {
    const { rows } = await db.admin.query("select public, file_size_limit from storage.buckets where id = 'transaction-documents'");
    expect(rows[0]).toEqual({ public: false, file_size_limit: "10485760" });
  });
});
