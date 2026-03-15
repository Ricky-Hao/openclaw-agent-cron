// ── Integration test: CRUD operations (wrapper architecture) ─────────
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDatabase } from "../../src/store/db.js";
import { WrapperJobsRepo } from "../../src/store/wrapper-jobs-repo.js";
import { AuditRepo } from "../../src/store/audit-repo.js";
import { MockGatewayCronClient } from "../helpers/mock-gateway.js";
import { testConfig, parseResult } from "../helpers/test-config.js";
import { createAddExecute } from "../../src/tools/add.js";
import { createListExecute } from "../../src/tools/list.js";
import { createGetExecute } from "../../src/tools/get.js";
import { createUpdateExecute } from "../../src/tools/update.js";
import { createRemoveExecute } from "../../src/tools/remove.js";
import { createPauseExecute } from "../../src/tools/pause.js";
import { createResumeExecute } from "../../src/tools/resume.js";
import { createRunExecute } from "../../src/tools/run.js";
import { createRunsExecute } from "../../src/tools/runs.js";

const config = testConfig;

describe("CRUD Integration (wrapper)", () => {
  let gateway: MockGatewayCronClient;
  let wrapperRepo: WrapperJobsRepo;
  let auditRepo: AuditRepo;

  let addExec: ReturnType<typeof createAddExecute>;
  let listExec: ReturnType<typeof createListExecute>;
  let getExec: ReturnType<typeof createGetExecute>;
  let updateExec: ReturnType<typeof createUpdateExecute>;
  let removeExec: ReturnType<typeof createRemoveExecute>;
  let pauseExec: ReturnType<typeof createPauseExecute>;
  let resumeExec: ReturnType<typeof createResumeExecute>;
  let runExec: ReturnType<typeof createRunExecute>;
  let runsExec: ReturnType<typeof createRunsExecute>;

  beforeEach(() => {
    const db = openMemoryDatabase();
    gateway = new MockGatewayCronClient();
    wrapperRepo = new WrapperJobsRepo(db);
    auditRepo = new AuditRepo(db);

    addExec = createAddExecute(gateway, wrapperRepo, auditRepo, config);
    listExec = createListExecute(gateway, wrapperRepo, config);
    getExec = createGetExecute(gateway, wrapperRepo, config);
    updateExec = createUpdateExecute(gateway, wrapperRepo, auditRepo, config);
    removeExec = createRemoveExecute(gateway, wrapperRepo, auditRepo, config);
    pauseExec = createPauseExecute(gateway, wrapperRepo, auditRepo, config);
    resumeExec = createResumeExecute(gateway, wrapperRepo, auditRepo, config);
    runExec = createRunExecute(gateway, wrapperRepo, auditRepo, config);
    runsExec = createRunsExecute(gateway, wrapperRepo, config);
  });

  it("creates a job with agent_cron_add", async () => {
    const result = await addExec("t1", {
      name: "morning-report",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "Generate morning report" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    const data = parseResult(result) as { ok: boolean; job: { id: string; name: string; ownerAgentId: string } };
    assert.equal(data.ok, true);
    assert.ok(data.job.id);
    assert.equal(data.job.name, "morning-report");
    assert.equal(data.job.ownerAgentId, "agent-a");

    // Verify inner cron was called
    assert.equal(gateway.jobs.size, 1);
  });

  it("creates a job and stores the wrapper→inner mapping", async () => {
    const result = await addExec("t1", {
      name: "mapped-job",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    const data = parseResult(result) as { ok: boolean; job: { id: string } };
    const wj = wrapperRepo.getById(data.job.id);
    assert.ok(wj, "wrapper job should exist in local DB");
    assert.ok(wj!.innerJobId, "wrapper job should have inner job ID");

    // Inner job should exist in mock gateway
    assert.ok(gateway.jobs.has(wj!.innerJobId));
  });

  it("lists jobs with agent_cron_list", async () => {
    await addExec("t1", {
      name: "job-1",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    await addExec("t2", {
      name: "job-2",
      schedule: { kind: "every", intervalSeconds: 600 },
      payload: { kind: "agentTurn", message: "test2" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    const result = await listExec("t3", {}, "agent-a");
    const data = parseResult(result) as { ok: boolean; jobs: unknown[]; count: number };
    assert.equal(data.ok, true);
    assert.equal(data.count, 2);
  });

  it("gets a job by ID with agent_cron_get", async () => {
    const addResult = await addExec("t1", {
      name: "my-job",
      schedule: { kind: "cron", expr: "*/5 * * * *" },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    const getResult = await getExec("t2", { jobId: addData.job.id }, "agent-a");
    const getData = parseResult(getResult) as { ok: boolean; job: { id: string; name: string } };
    assert.equal(getData.ok, true);
    assert.equal(getData.job.name, "my-job");
  });

  it("updates a job with agent_cron_update", async () => {
    const addResult = await addExec("t1", {
      name: "original",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    const updateResult = await updateExec("t2", {
      jobId: addData.job.id,
      name: "updated",
    }, "agent-a");
    const updateData = parseResult(updateResult) as { ok: boolean; job: { name: string } };
    assert.equal(updateData.ok, true);
    assert.equal(updateData.job.name, "updated");
  });

  it("removes a job with agent_cron_remove (soft-delete)", async () => {
    const addResult = await addExec("t1", {
      name: "to-delete",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    const removeResult = await removeExec("t2", { jobId: addData.job.id }, "agent-a");
    const removeData = parseResult(removeResult) as { ok: boolean; deleted: string; mode: string };
    assert.equal(removeData.ok, true);
    assert.equal(removeData.deleted, addData.job.id);
    assert.equal(removeData.mode, "soft");

    // Verify it's gone from wrapper repo
    const getResult = await getExec("t3", { jobId: addData.job.id }, "agent-a");
    const getData = parseResult(getResult) as { error: string };
    assert.equal(getData.error, "NOT_FOUND");

    // Verify gateway cron.remove was called
    assert.equal(gateway.removeCalls.length, 1);
  });
  it("pauses and resumes a job", async () => {
    const addResult = await addExec("t1", {
      name: "pausable",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    // Pause
    const pauseResult = await pauseExec("t2", { jobId: addData.job.id }, "agent-a");
    const pauseData = parseResult(pauseResult) as { ok: boolean; paused: string };
    assert.equal(pauseData.ok, true);

    // Verify inner job is disabled
    const wj = wrapperRepo.getById(addData.job.id)!;
    const innerJob = gateway.jobs.get(wj.innerJobId)!;
    assert.equal(innerJob.enabled, false);

    // Resume
    const resumeResult = await resumeExec("t3", { jobId: addData.job.id }, "agent-a");
    const resumeData = parseResult(resumeResult) as { ok: boolean; resumed: string };
    assert.equal(resumeData.ok, true);

    // Verify inner job is enabled again
    const innerJobAfter = gateway.jobs.get(wj.innerJobId)!;
    assert.equal(innerJobAfter.enabled, true);
  });

  it("manually triggers a job and queries runs", async () => {
    const addResult = await addExec("t1", {
      name: "runnable",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "do stuff" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    // Trigger manual run
    const runResult = await runExec("t2", { jobId: addData.job.id }, "agent-a");
    const runData = parseResult(runResult) as { ok: boolean; message: string };
    assert.equal(runData.ok, true);
    assert.equal(gateway.runCalls.length, 1);

    // Query runs
    const runsResult = await runsExec("t3", { jobId: addData.job.id }, "agent-a");
    const runsData = parseResult(runsResult) as { ok: boolean; runs: unknown[]; count: number };
    assert.equal(runsData.ok, true);
    assert.ok(runsData.count >= 1);
  });

  it("enforces quota limit", async () => {
    const tightConfig = { ...config, maxJobsPerAgent: 2 };
    const tightAdd = createAddExecute(gateway, wrapperRepo, auditRepo, tightConfig);

    await tightAdd("t1", {
      name: "j1",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    await tightAdd("t2", {
      name: "j2",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");

    // Third job should fail
    const result = await tightAdd("t3", {
      name: "j3",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "QUOTA_EXCEEDED");
  });

  it("enforces minimum interval", async () => {
    const result = await addExec("t1", {
      name: "too-fast",
      schedule: { kind: "every", intervalSeconds: 10 }, // < minIntervalSeconds=60
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "VALIDATION_ERROR");
  });

  it("rejects systemEvent payload", async () => {
    const result = await addExec("t1", {
      name: "system-job",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "systemEvent", event: "health-check" },
    }, "agent-a");
    const data = parseResult(result) as { error: string };
    assert.equal(data.error, "VALIDATION_ERROR");
  });

  it("job response includes enabled state from inner cron", async () => {
    const result = await addExec("t1", {
      name: "state-job",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { ok: boolean; job: { enabled: boolean; state: { nextRunAtMs: number } } };
    assert.equal(data.ok, true);
    assert.equal(data.job.enabled, true);
    assert.ok(data.job.state.nextRunAtMs > 0);
  });

  it("supports at schedule", async () => {
    const futureMs = Date.now() + 3600_000;
    const result = await addExec("t1", {
      name: "one-shot",
      schedule: { kind: "at", at: futureMs },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { ok: boolean; job: { schedule: { kind: string; at: number } } };
    assert.equal(data.ok, true);
    assert.equal(data.job.schedule.kind, "at");
    assert.equal(data.job.schedule.at, futureMs);
  });

  it("supports cron schedule with timezone", async () => {
    const result = await addExec("t1", {
      name: "cron-job",
      schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "Asia/Shanghai" },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { ok: boolean; job: { schedule: { kind: string; expr: string; tz: string } } };
    assert.equal(data.ok, true);
    assert.equal(data.job.schedule.kind, "cron");
    assert.equal(data.job.schedule.expr, "0 9 * * 1-5");
    assert.equal(data.job.schedule.tz, "Asia/Shanghai");
  });

  it("cron.update carries a patch object", async () => {
    const addResult = await addExec("t1", {
      name: "patch-test",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    // Update the job name
    await updateExec("t2", {
      jobId: addData.job.id,
      name: "renamed",
    }, "agent-a");

    // Verify the gateway was called with { jobId, patch } shape
    assert.ok(gateway.updateCalls.length >= 1, "gateway.update should have been called");
    const lastCall = gateway.updateCalls[gateway.updateCalls.length - 1];
    assert.ok(lastCall.jobId, "cron.update must include jobId");
    assert.ok(typeof lastCall.patch === "object" && lastCall.patch !== null,
      "cron.update must include a patch object");
    const patch = lastCall.patch as Record<string, unknown>;
    assert.equal(patch.name, "renamed");
  });

  it("cron.update for pause carries patch with enabled:false", async () => {
    const addResult = await addExec("t1", {
      name: "pause-patch",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    await pauseExec("t2", { jobId: addData.job.id }, "agent-a");

    // Verify pause calls gateway.update with patch.enabled = false
    const pauseCall = gateway.updateCalls.find(
      (c) => (c.patch as Record<string, unknown>)?.enabled === false,
    );
    assert.ok(pauseCall, "pause should call gateway.update with patch.enabled=false");
    assert.equal((pauseCall!.patch as Record<string, unknown>).enabled, false);
  });

  it("get returns innerStateAvailable:false when gateway list fails", async () => {
    const addResult = await addExec("t1", {
      name: "fallback-get",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    // Make gateway.list() throw to simulate unavailable inner state
    gateway.listShouldThrow = true;
    const getResult = await getExec("t2", { jobId: addData.job.id }, "agent-a");
    gateway.listShouldThrow = false;

    const getData = parseResult(getResult) as { ok: boolean; innerStateAvailable: boolean; job: { id: string } };
    assert.equal(getData.ok, true);
    assert.equal(getData.innerStateAvailable, false);
    assert.equal(getData.job.id, addData.job.id);
  });

  it("get returns innerStateAvailable:true when gateway works", async () => {
    const addResult = await addExec("t1", {
      name: "healthy-get",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    const getResult = await getExec("t2", { jobId: addData.job.id }, "agent-a");
    const getData = parseResult(getResult) as { ok: boolean; innerStateAvailable: boolean; job: { enabled: boolean } };
    assert.equal(getData.ok, true);
    assert.equal(getData.innerStateAvailable, true);
    assert.equal(getData.job.enabled, true);
  });

  it("add rejects timeoutSeconds exceeding maxTimeoutSeconds", async () => {
    const result = await addExec("t1", {
      name: "timeout-too-high",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test", timeoutSeconds: 9999 },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
    assert.match(data.message, /timeoutSeconds/);
  });

  it("add rejects timeoutSeconds less than 1", async () => {
    const result = await addExec("t1", {
      name: "timeout-zero",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test", timeoutSeconds: 0 },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
    assert.match(data.message, /timeoutSeconds/);
  });

  it("add accepts valid timeoutSeconds within limit", async () => {
    const result = await addExec("t1", {
      name: "timeout-ok",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test", timeoutSeconds: 300 },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const data = parseResult(result) as { ok: boolean; job: { id: string } };
    assert.equal(data.ok, true);
    assert.ok(data.job.id);
  });

  it("update rejects timeoutSeconds exceeding maxTimeoutSeconds", async () => {
    const addResult = await addExec("t1", {
      name: "update-timeout",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    const updateResult = await updateExec("t2", {
      jobId: addData.job.id,
      payload: { kind: "agentTurn", message: "updated", timeoutSeconds: 9999 },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-a");
    const updateData = parseResult(updateResult) as { error: string; message: string };
    assert.equal(updateData.error, "VALIDATION_ERROR");
    assert.match(updateData.message, /timeoutSeconds/);
  });

  it("admin can add agentTurn job with sessionTarget=isolated", async () => {
    const result = await addExec("t1", {
      name: "admin-agent-turn",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "admin task" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "main"); // 'main' is admin per testConfig

    const data = parseResult(result) as { ok: boolean; job: { id: string; name: string; ownerAgentId: string } };
    assert.equal(data.ok, true);
    assert.equal(data.job.name, "admin-agent-turn");
    assert.equal(data.job.ownerAgentId, "main");

    // Verify the inner job was created with sessionTarget="isolated" (not "main")
    const wj = wrapperRepo.getById(data.job.id)!;
    const innerJob = gateway.jobs.get(wj.innerJobId)!;
    assert.equal(innerJob.sessionTarget, "isolated");
  });

  // ── Delivery validation tests ─────────────────────────────────────

  it("add rejects agentTurn without delivery", async () => {
    const result = await addExec("t1", {
      name: "no-delivery",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
    assert.match(data.message, /delivery is required/);
  });

  it("add rejects delivery with mode=none for agentTurn", async () => {
    const result = await addExec("t1", {
      name: "bad-mode",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "webhook" as any, channel: "ch", to: "user" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
    assert.match(data.message, /delivery\.mode must be "announce" or "none"/);
  });

  it("add rejects delivery with empty channel", async () => {
    const result = await addExec("t1", {
      name: "empty-channel",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "", to: "user" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
    assert.match(data.message, /delivery\.channel/);
  });

  it("add rejects delivery with empty to", async () => {
    const result = await addExec("t1", {
      name: "empty-to",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
    assert.match(data.message, /delivery\.to/);
  });

  it("add tool passes callerAgentId as agentId in gatewayParams", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const origAdd = gateway.add.bind(gateway);
    gateway.add = async (params: Record<string, unknown>) => {
      capturedParams = params;
      return origAdd(params);
    };

    await addExec("t1", {
      name: "agent-id-tool-test",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    }, "agent-xyz");

    assert.ok(capturedParams, "gateway.add should have been called");
    assert.equal(capturedParams!.agentId, "agent-xyz", "agentId should equal callerAgentId");

    gateway.add = origAdd;
  });

  it("add rejects delivery with missing channel and to", async () => {
    const result = await addExec("t1", {
      name: "partial-delivery",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce" },
    }, "agent-a");
    const data = parseResult(result) as { error: string; message: string };
    assert.equal(data.error, "VALIDATION_ERROR");
  });

  it("update rejects payload change to agentTurn when existing delivery is null", async () => {
    // Create a job with valid delivery
    const addResult = await addExec("t1", {
      name: "delivery-update-test",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "user" },
    }, "agent-a");
    const addData = parseResult(addResult) as { ok: boolean; job: { id: string } };

    // Manually clear delivery in spec to simulate legacy data
    const wj = wrapperRepo.getById(addData.job.id)!;
    const spec = JSON.parse(wj.specJson);
    spec.delivery = null;
    wrapperRepo.updateSpec(wj.id, JSON.stringify(spec));

    // Update payload without providing delivery — should fail
    const updateResult = await updateExec("t2", {
      jobId: addData.job.id,
      payload: { kind: "agentTurn", message: "new msg" },
    }, "agent-a");
    const updateData = parseResult(updateResult) as { error: string; message: string };
    assert.equal(updateData.error, "VALIDATION_ERROR");
    assert.match(updateData.message, /delivery is required/);
  });
});
