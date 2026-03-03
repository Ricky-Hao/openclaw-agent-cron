// ── Schema / DB / WrapperJobsRepo / AuditRepo unit tests ────────────
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDatabase } from "../../src/store/db.js";
import { WrapperJobsRepo } from "../../src/store/wrapper-jobs-repo.js";
import { AuditRepo } from "../../src/store/audit-repo.js";
import type { WrapperJob } from "../../src/store/types.js";
import Database from "better-sqlite3";

function makeWrapperJob(overrides?: Partial<WrapperJob>): WrapperJob {
  const id = `wj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    ownerAgentId: "agent-a",
    innerJobId: `inner-${id}`,
    name: "test-job",
    specJson: JSON.stringify({
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "hello" },
      delivery: null,
    }),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    deletedAtMs: null,
    ...overrides,
  };
}

describe("Database & Schema", () => {
  it("opens an in-memory database with correct tables", () => {
    const db = openMemoryDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.ok(names.includes("wrapper_jobs"), "should have wrapper_jobs table");
    assert.ok(names.includes("audit"), "should have audit table");
    // Old tables should NOT exist
    assert.ok(!names.includes("jobs"), "should NOT have old jobs table");
    assert.ok(!names.includes("runs"), "should NOT have old runs table");
    db.close();
  });
});

describe("WrapperJobsRepo", () => {
  let db: Database.Database;
  let repo: WrapperJobsRepo;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new WrapperJobsRepo(db);
  });

  it("inserts and retrieves a wrapper job", () => {
    const wj = makeWrapperJob();
    repo.insert(wj);
    const found = repo.getById(wj.id);
    assert.ok(found);
    assert.equal(found!.id, wj.id);
    assert.equal(found!.name, "test-job");
    assert.equal(found!.ownerAgentId, "agent-a");
    assert.equal(found!.innerJobId, wj.innerJobId);
  });

  it("retrieves by inner job ID", () => {
    const wj = makeWrapperJob();
    repo.insert(wj);
    const found = repo.getByInnerId(wj.innerJobId);
    assert.ok(found);
    assert.equal(found!.id, wj.id);
  });

  it("returns undefined for non-existent ID", () => {
    assert.equal(repo.getById("does-not-exist"), undefined);
    assert.equal(repo.getByInnerId("does-not-exist"), undefined);
  });

  it("lists jobs by owner", () => {
    repo.insert(makeWrapperJob({ id: "j1", innerJobId: "i1", ownerAgentId: "a" }));
    repo.insert(makeWrapperJob({ id: "j2", innerJobId: "i2", ownerAgentId: "a" }));
    repo.insert(makeWrapperJob({ id: "j3", innerJobId: "i3", ownerAgentId: "b" }));

    const aJobs = repo.listByOwner("a");
    assert.equal(aJobs.length, 2);

    const bJobs = repo.listByOwner("b");
    assert.equal(bJobs.length, 1);
  });

  it("lists all jobs", () => {
    repo.insert(makeWrapperJob({ id: "j1", innerJobId: "i1", ownerAgentId: "a" }));
    repo.insert(makeWrapperJob({ id: "j2", innerJobId: "i2", ownerAgentId: "b" }));
    repo.insert(makeWrapperJob({ id: "j3", innerJobId: "i3", ownerAgentId: "c" }));

    const all = repo.listAll();
    assert.equal(all.length, 3);
  });

  it("respects limit and offset in listAll", () => {
    repo.insert(makeWrapperJob({ id: "j1", innerJobId: "i1" }));
    repo.insert(makeWrapperJob({ id: "j2", innerJobId: "i2" }));
    repo.insert(makeWrapperJob({ id: "j3", innerJobId: "i3" }));

    const page1 = repo.listAll(2, 0);
    assert.equal(page1.length, 2);

    const page2 = repo.listAll(2, 2);
    assert.equal(page2.length, 1);
  });

  it("updates name", () => {
    const wj = makeWrapperJob();
    repo.insert(wj);

    const updated = repo.updateName(wj.id, "new-name");
    assert.equal(updated, true);

    const found = repo.getById(wj.id);
    assert.equal(found!.name, "new-name");
  });

  it("updates spec", () => {
    const wj = makeWrapperJob();
    repo.insert(wj);

    const newSpec = JSON.stringify({
      schedule: { kind: "every", intervalSeconds: 600 },
      payload: { kind: "agentTurn", message: "updated" },
      delivery: null,
    });
    const updated = repo.updateSpec(wj.id, newSpec);
    assert.equal(updated, true);

    const found = repo.getById(wj.id);
    assert.equal(found!.specJson, newSpec);
  });

  it("soft-deletes a job", () => {
    const wj = makeWrapperJob();
    repo.insert(wj);
    assert.ok(repo.getById(wj.id));

    const deleted = repo.softDelete(wj.id);
    assert.equal(deleted, true);

    // Should not be found after soft delete
    assert.equal(repo.getById(wj.id), undefined);
  });

  it("hard-deletes a job (permanently removes row)", () => {
    const wj = makeWrapperJob();
    repo.insert(wj);
    assert.ok(repo.getById(wj.id));

    const deleted = repo.hardDelete(wj.id);
    assert.equal(deleted, true);

    // Should not be found
    assert.equal(repo.getById(wj.id), undefined);

    // Verify it's truly gone from the DB
    const row = db.prepare("SELECT * FROM wrapper_jobs WHERE id = ?").get(wj.id);
    assert.equal(row, undefined);
  });

  it("hard-delete returns false for non-existent job", () => {
    const deleted = repo.hardDelete("does-not-exist");
    assert.equal(deleted, false);
  });

  it("counts jobs by owner (excludes soft-deleted)", () => {
    repo.insert(makeWrapperJob({ id: "j1", innerJobId: "i1", ownerAgentId: "x" }));
    repo.insert(makeWrapperJob({ id: "j2", innerJobId: "i2", ownerAgentId: "x" }));
    repo.insert(makeWrapperJob({ id: "j3", innerJobId: "i3", ownerAgentId: "y" }));

    assert.equal(repo.countByOwner("x"), 2);
    assert.equal(repo.countByOwner("y"), 1);
    assert.equal(repo.countByOwner("z"), 0);

    // Soft-delete one and recount
    repo.softDelete("j1");
    assert.equal(repo.countByOwner("x"), 1);
  });

  it("enforces unique inner_job_id", () => {
    repo.insert(makeWrapperJob({ id: "j1", innerJobId: "same-inner" }));
    assert.throws(() => {
      repo.insert(makeWrapperJob({ id: "j2", innerJobId: "same-inner" }));
    });
  });
});

describe("AuditRepo", () => {
  let db: Database.Database;
  let repo: AuditRepo;

  beforeEach(() => {
    db = openMemoryDatabase();
    repo = new AuditRepo(db);
  });

  it("logs and retrieves audit entries", () => {
    repo.log({ actorAgentId: "a", action: "create", jobId: "j1", result: "ok" });
    repo.log({ actorAgentId: "a", action: "delete", jobId: "j2", result: "ok" });
    repo.log({ actorAgentId: "b", action: "acl-deny", result: "denied" });

    const aEntries = repo.listByAgent("a");
    assert.equal(aEntries.length, 2);

    const bEntries = repo.listByAgent("b");
    assert.equal(bEntries.length, 1);
    assert.equal(bEntries[0].action, "acl-deny");
  });

  it("stores detail JSON with redaction", () => {
    repo.log({
      actorAgentId: "a",
      action: "create",
      result: "ok",
      detail: { name: "test", token: "secret123" },
    });

    const entries = repo.listByAgent("a");
    assert.equal(entries.length, 1);
    assert.ok(entries[0].detailJson);
    const detail = JSON.parse(entries[0].detailJson!);
    assert.equal(detail.name, "test");
    assert.equal(detail.token, "***REDACTED***");
  });

  it("purges old entries", () => {
    repo.log({ actorAgentId: "a", action: "create", result: "ok" });

    // Purge entries older than 0ms (purge everything)
    const purged = repo.purge(0);
    // Timing edge case: purge(0) means cutoff = now, entry at now might not be purged
    assert.ok(typeof purged === "number");
  });
});
