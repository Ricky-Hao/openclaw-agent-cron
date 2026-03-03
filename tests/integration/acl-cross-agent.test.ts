// ── Integration test: ACL cross-agent denial (wrapper architecture) ──
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
import { createPauseExecute } from "../../src/tools/pause.js";
import { createResumeExecute } from "../../src/tools/resume.js";
import { createRunExecute } from "../../src/tools/run.js";
import { createRunsExecute } from "../../src/tools/runs.js";
import { createListExecute } from "../../src/tools/list.js";

const config = testConfig;

describe("Cross-Agent ACL Denial (wrapper)", () => {
  let gateway: MockGatewayCronClient;
  let wrapperRepo: WrapperJobsRepo;
  let auditRepo: AuditRepo;
  let createdJobId: string;

  beforeEach(async () => {
    const db = openMemoryDatabase();
    gateway = new MockGatewayCronClient();
    wrapperRepo = new WrapperJobsRepo(db);
    auditRepo = new AuditRepo(db);

    // Create a job owned by agent-a
    const addExec = createAddExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await addExec("setup", {
      name: "agent-a-job",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { ok: boolean; job: { id: string } };
    createdJobId = data.job.id;
  });

  it("agent-b CANNOT get agent-a's job", async () => {
    const getExec = createGetExecute(gateway, wrapperRepo, config);
    const result = await getExec("t1", { jobId: createdJobId }, "agent-b");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "ACL_DENY");
    assert.match(data.message, /agent-b.*not authorized/);
  });

  it("agent-b CANNOT update agent-a's job", async () => {
    const updateExec = createUpdateExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await updateExec("t1", { jobId: createdJobId, name: "hacked" }, "agent-b");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "ACL_DENY");
  });

  it("agent-b CANNOT remove agent-a's job", async () => {
    const removeExec = createRemoveExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await removeExec("t1", { jobId: createdJobId }, "agent-b");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "ACL_DENY");
  });

  it("agent-b CANNOT pause agent-a's job", async () => {
    const pauseExec = createPauseExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await pauseExec("t1", { jobId: createdJobId }, "agent-b");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "ACL_DENY");
  });

  it("agent-b CANNOT resume agent-a's job", async () => {
    const resumeExec = createResumeExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await resumeExec("t1", { jobId: createdJobId }, "agent-b");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "ACL_DENY");
  });

  it("agent-b CANNOT run agent-a's job", async () => {
    const runExec = createRunExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await runExec("t1", { jobId: createdJobId }, "agent-b");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "ACL_DENY");
  });

  it("agent-b CANNOT query runs of agent-a's job", async () => {
    const runsExec = createRunsExecute(gateway, wrapperRepo, config);
    const result = await runsExec("t1", { jobId: createdJobId }, "agent-b");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "ACL_DENY");
  });

  it("agent-b list only sees own jobs (not agent-a's)", async () => {
    const listExec = createListExecute(gateway, wrapperRepo, config);
    const result = await listExec("t1", {}, "agent-b");
    const data = parseResult(result) as { ok: boolean; jobs: unknown[]; count: number };
    assert.equal(data.ok, true);
    assert.equal(data.count, 0); // agent-b has no jobs
  });

  // ── Admin cross-agent access (positive tests) ─────────────────────

  it("admin CAN get agent-a's job", async () => {
    const getExec = createGetExecute(gateway, wrapperRepo, config);
    const result = await getExec("t1", { jobId: createdJobId }, "main");
    const data = parseResult(result) as { ok: boolean; job: { id: string } };
    assert.equal(data.ok, true);
    assert.equal(data.job.id, createdJobId);
  });

  it("admin CAN update agent-a's job", async () => {
    const updateExec = createUpdateExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await updateExec("t1", { jobId: createdJobId, name: "admin-updated" }, "main");
    const data = parseResult(result) as { ok: boolean; job: { name: string } };
    assert.equal(data.ok, true);
    assert.equal(data.job.name, "admin-updated");
  });

  it("admin CAN list all agents' jobs", async () => {
    const listExec = createListExecute(gateway, wrapperRepo, config);
    const result = await listExec("t1", {}, "main");
    const data = parseResult(result) as { ok: boolean; jobs: unknown[]; count: number };
    assert.equal(data.ok, true);
    assert.equal(data.count, 1); // agent-a's job
  });

  it("admin CAN remove agent-a's job", async () => {
    const removeExec = createRemoveExecute(gateway, wrapperRepo, auditRepo, config);
    const result = await removeExec("t1", { jobId: createdJobId }, "main");
    const data = parseResult(result) as { ok: boolean; deleted: string };
    assert.equal(data.ok, true);
  });
});
