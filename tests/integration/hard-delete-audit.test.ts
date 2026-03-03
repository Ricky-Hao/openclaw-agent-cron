// ── Integration test: hard delete & update audit (wrapper architecture)
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDatabase } from "../../src/store/db.js";
import { WrapperJobsRepo } from "../../src/store/wrapper-jobs-repo.js";
import { AuditRepo } from "../../src/store/audit-repo.js";
import { MockGatewayCronClient } from "../helpers/mock-gateway.js";
import { testConfig, parseResult } from "../helpers/test-config.js";
import { createAddExecute } from "../../src/tools/add.js";
import { createGetExecute } from "../../src/tools/get.js";
import { createUpdateExecute } from "../../src/tools/update.js";
import { createRemoveExecute } from "../../src/tools/remove.js";

const config = testConfig;

describe("Hard Delete (wrapper)", () => {
  let gateway: MockGatewayCronClient;
  let wrapperRepo: WrapperJobsRepo;
  let auditRepo: AuditRepo;
  let addExec: ReturnType<typeof createAddExecute>;
  let getExec: ReturnType<typeof createGetExecute>;
  let removeExec: ReturnType<typeof createRemoveExecute>;

  beforeEach(() => {
    const db = openMemoryDatabase();
    gateway = new MockGatewayCronClient();
    wrapperRepo = new WrapperJobsRepo(db);
    auditRepo = new AuditRepo(db);
    addExec = createAddExecute(gateway, wrapperRepo, auditRepo, config);
    getExec = createGetExecute(gateway, wrapperRepo, config);
    removeExec = createRemoveExecute(gateway, wrapperRepo, auditRepo, config);
  });

  it("admin can hard-delete a job permanently", async () => {
    // Create job as agent-a
    const addResult = await addExec("t1", {
      name: "to-hard-delete",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };
    assert.equal(addData.ok, true);

    // Admin hard-deletes it
    const removeResult = await removeExec("t2", { jobId: addData.job.id, hard: true }, "main");
    const removeData = parseResult(removeResult) as { ok: boolean; deleted: string; mode: string };
    assert.equal(removeData.ok, true);
    assert.equal(removeData.deleted, addData.job.id);
    assert.equal(removeData.mode, "hard");

    // Verify it's gone (even for admin — hard delete removes the row entirely)
    const getResult = await getExec("t3", { jobId: addData.job.id }, "main");
    const getData = parseResult(getResult) as { error: string };
    assert.equal(getData.error, "NOT_FOUND");

    // Verify gateway cron.remove was called
    assert.equal(gateway.removeCalls.length, 1);
  });

  it("non-admin cannot hard-delete (ACL_DENY)", async () => {
    // Create job as agent-a
    const addResult = await addExec("t1", {
      name: "not-yours",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    // agent-a tries to hard-delete (should be denied — not admin)
    const removeResult = await removeExec("t2", { jobId: addData.job.id, hard: true }, "agent-a");
    const removeData = parseResult(removeResult) as { error: string };
    assert.equal(removeData.error, "ACL_DENY");

    // Verify job still exists
    const getResult = await getExec("t3", { jobId: addData.job.id }, "agent-a");
    const getData = parseResult(getResult) as { ok: boolean; job: { id: string } };
    assert.equal(getData.ok, true);
  });

  it("soft-delete still works as before (default behavior)", async () => {
    const addResult = await addExec("t1", {
      name: "soft-me",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    const removeResult = await removeExec("t2", { jobId: addData.job.id }, "agent-a");
    const removeData = parseResult(removeResult) as { ok: boolean; deleted: string; mode: string };
    assert.equal(removeData.ok, true);
    assert.equal(removeData.mode, "soft");

    // Verify it's gone (soft-deleted, not visible)
    const getResult = await getExec("t3", { jobId: addData.job.id }, "agent-a");
    const getData = parseResult(getResult) as { error: string };
    assert.equal(getData.error, "NOT_FOUND");
  });

  it("hard-delete audit log records mode=hard", async () => {
    const addResult = await addExec("t1", {
      name: "audit-hard",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    await removeExec("t2", { jobId: addData.job.id, hard: true }, "main");

    // Check audit logs for the admin
    const entries = auditRepo.listByAgent("main", 10);
    const deleteEntry = entries.find(e => e.action === "delete");
    assert.ok(deleteEntry, "Expected a delete audit entry");
    const detail = deleteEntry.detailJson ? JSON.parse(deleteEntry.detailJson) : null;
    assert.ok(detail, "Expected detail in audit entry");
    assert.equal(detail.mode, "hard");
  });
});

describe("Update Audit Before/After (wrapper)", () => {
  let gateway: MockGatewayCronClient;
  let wrapperRepo: WrapperJobsRepo;
  let auditRepo: AuditRepo;
  let addExec: ReturnType<typeof createAddExecute>;
  let updateExec: ReturnType<typeof createUpdateExecute>;

  beforeEach(() => {
    const db = openMemoryDatabase();
    gateway = new MockGatewayCronClient();
    wrapperRepo = new WrapperJobsRepo(db);
    auditRepo = new AuditRepo(db);
    addExec = createAddExecute(gateway, wrapperRepo, auditRepo, config);
    updateExec = createUpdateExecute(gateway, wrapperRepo, auditRepo, config);
  });

  it("update audit includes before/after snapshot", async () => {
    const addResult = await addExec("t1", {
      name: "original-name",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "original message" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    await updateExec("t2", {
      jobId: addData.job.id,
      name: "updated-name",
    }, "agent-a");

    const entries = auditRepo.listByAgent("agent-a", 10);
    const updateEntry = entries.find(e => e.action === "update");
    assert.ok(updateEntry, "Expected an update audit entry");
    const detail = updateEntry.detailJson ? JSON.parse(updateEntry.detailJson) : null;
    assert.ok(detail, "Expected detail in update audit entry");
    assert.ok(detail.before, "Expected before snapshot");
    assert.ok(detail.after, "Expected after snapshot");
    // before and after are the raw spec JSON strings
    const before = JSON.parse(detail.before);
    const after = JSON.parse(detail.after);
    assert.equal(before.schedule.intervalSeconds, 300);
    assert.equal(after.schedule.intervalSeconds, 300); // schedule unchanged
  });

  it("before/after shows payload change", async () => {
    const addResult = await addExec("t1", {
      name: "payload-test",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "before message" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    await updateExec("t2", {
      jobId: addData.job.id,
      payload: { kind: "agentTurn", message: "after message" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    const entries = auditRepo.listByAgent("agent-a", 10);
    const updateEntry = entries.find(e => e.action === "update");
    assert.ok(updateEntry);
    const detail = JSON.parse(updateEntry!.detailJson!);
    const before = JSON.parse(detail.before);
    const after = JSON.parse(detail.after);
    assert.equal(before.payload.message, "before message");
    assert.equal(after.payload.message, "after message");
  });

  it("before/after shows schedule change", async () => {
    const addResult = await addExec("t1", {
      name: "schedule-test",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    await updateExec("t2", {
      jobId: addData.job.id,
      schedule: { kind: "every", intervalSeconds: 600 },
    }, "agent-a");

    const entries = auditRepo.listByAgent("agent-a", 10);
    const updateEntry = entries.find(e => e.action === "update");
    assert.ok(updateEntry);
    const detail = JSON.parse(updateEntry!.detailJson!);
    const before = JSON.parse(detail.before);
    const after = JSON.parse(detail.after);
    assert.equal(before.schedule.intervalSeconds, 300);
    assert.equal(after.schedule.intervalSeconds, 600);
  });
});
