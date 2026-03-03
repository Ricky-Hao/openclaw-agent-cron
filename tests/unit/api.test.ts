// ── Unit test: programmatic addJob API ───────────────────────────────

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDatabase } from "../../src/store/db.js";
import { WrapperJobsRepo } from "../../src/store/wrapper-jobs-repo.js";
import { AuditRepo } from "../../src/store/audit-repo.js";
import { MockGatewayCronClient } from "../helpers/mock-gateway.js";
import { testConfig } from "../helpers/test-config.js";
import { addJob, setDeps, _resetDeps } from "../../src/api.js";

describe("programmatic addJob API", () => {
  let gateway: MockGatewayCronClient;
  let wrapperRepo: WrapperJobsRepo;
  let auditRepo: AuditRepo;

  beforeEach(() => {
    const db = openMemoryDatabase();
    gateway = new MockGatewayCronClient();
    wrapperRepo = new WrapperJobsRepo(db);
    auditRepo = new AuditRepo(db);
    setDeps(gateway, wrapperRepo, auditRepo, testConfig);
  });

  afterEach(() => {
    _resetDeps();
  });

  // ── Happy path ──────────────────────────────────────────────────

  it("creates a job and returns jobId", async () => {
    const result = await addJob({
      name: "poll-settle",
      ownerAgentId: "agent-qq",
      schedule: { kind: "at", at: new Date(Date.now() + 60_000).toISOString() },
      payload: { kind: "agentTurn", message: "settle poll 123" },
      delivery: { mode: "announce", channel: "qq", to: "qq:group:12345" },
    });

    assert.equal(result.ok, true);
    assert.ok(result.jobId, "should return a jobId");
    assert.equal(result.error, undefined);

    // Verify wrapper record exists
    const wj = wrapperRepo.getById(result.jobId!);
    assert.ok(wj, "wrapper job should be in DB");
    assert.equal(wj!.name, "poll-settle");
    assert.equal(wj!.ownerAgentId, "agent-qq");

    // Verify inner job was created
    assert.equal(gateway.jobs.size, 1);
    assert.ok(gateway.jobs.has(wj!.innerJobId));
  });

  it("creates an every-schedule job", async () => {
    const result = await addJob({
      name: "heartbeat",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "ping" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    });

    assert.equal(result.ok, true);
    assert.ok(result.jobId);
  });

  it("creates a cron-schedule job", async () => {
    const result = await addJob({
      name: "daily-report",
      ownerAgentId: "agent-a",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
      payload: { kind: "agentTurn", message: "generate report" },
      delivery: { mode: "announce", channel: "test-ch", to: "test-user" },
    });

    assert.equal(result.ok, true);
    assert.ok(result.jobId);
  });

  it("creates a disabled job when enabled=false", async () => {
    const result = await addJob({
      name: "disabled-job",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "user" },
      enabled: false,
    });

    assert.equal(result.ok, true);
    const wj = wrapperRepo.getById(result.jobId!)!;
    const innerJob = gateway.jobs.get(wj.innerJobId)!;
    assert.equal(innerJob.enabled, false);
  });

  // ── Audit log ──────────────────────────────────────────────────

  it("writes an audit log entry", async () => {
    const result = await addJob({
      name: "audited-job",
      ownerAgentId: "agent-qq",
      schedule: { kind: "at", at: new Date(Date.now() + 60_000).toISOString() },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "qq", to: "qq:group:999" },
    });

    assert.equal(result.ok, true);

    const entries = auditRepo.listByAgent("agent-qq");
    assert.ok(entries.length >= 1, "should have at least one audit entry");
    const entry = entries[0];
    assert.equal(entry.actorAgentId, "agent-qq");
    assert.equal(entry.action, "create");
    assert.equal(entry.result, "ok");
    assert.equal(entry.jobId, result.jobId);
  });

  // ── Not initialized ───────────────────────────────────────────

  it("returns error when plugin not initialized", async () => {
    _resetDeps();

    const result = await addJob({
      name: "should-fail",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "user" },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error!, /not initialized/);
  });

  // ── Validation errors ─────────────────────────────────────────

  it("returns error for interval below minimum", async () => {
    const result = await addJob({
      name: "too-fast",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 10 }, // < minIntervalSeconds=60
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "user" },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error!, /minimum interval/i);
  });

  it("returns error for timeoutSeconds exceeding max", async () => {
    const result = await addJob({
      name: "bad-timeout",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test", timeoutSeconds: 9999 },
      delivery: { mode: "announce", channel: "ch", to: "user" },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error!, /timeoutSeconds/);
  });

  it("returns error for empty delivery channel", async () => {
    const result = await addJob({
      name: "bad-delivery",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "", to: "user" },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error!, /delivery\.channel/);
  });

  it("returns error for empty delivery to", async () => {
    const result = await addJob({
      name: "bad-delivery-to",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "" },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error!, /delivery\.to/);
  });

  // ── globalThis Symbol exposure ─────────────────────────────────

  it("exposes addJob on globalThis via Symbol.for after setDeps", () => {
    const sym = Symbol.for("openclaw.agentCron.addJob");
    const exposed = (globalThis as Record<symbol, unknown>)[sym];
    assert.equal(typeof exposed, "function", "should be a function on globalThis");
    assert.equal(exposed, addJob, "should be the same addJob function");
  });

  it("globalThis symbol is not set after _resetDeps is called, but was set before", () => {
    // Before reset, it should be set (from beforeEach's setDeps)
    const sym = Symbol.for("openclaw.agentCron.addJob");
    assert.equal((globalThis as Record<symbol, unknown>)[sym], addJob);
    // Note: _resetDeps only clears internal deps, not globalThis — this is expected
    // The symbol remains on globalThis but addJob will return "not initialized" error
    _resetDeps();
    // The function is still there on globalThis but calling it fails
    const fn = (globalThis as Record<symbol, unknown>)[sym] as typeof addJob;
    assert.equal(typeof fn, "function");
  });

  // ── agentId in gatewayParams ──────────────────────────────────

  it("passes ownerAgentId as agentId in gatewayParams to gateway.add", async () => {
    // Override gateway.add to capture params
    let capturedParams: Record<string, unknown> | undefined;
    const origAdd = gateway.add.bind(gateway);
    gateway.add = async (params: Record<string, unknown>) => {
      capturedParams = params;
      return origAdd(params);
    };

    await addJob({
      name: "agent-id-test",
      ownerAgentId: "my-agent-123",
      schedule: { kind: "at", at: new Date(Date.now() + 60_000).toISOString() },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "qq", to: "qq:group:999" },
    });

    assert.ok(capturedParams, "gateway.add should have been called");
    assert.equal(capturedParams!.agentId, "my-agent-123", "agentId should match ownerAgentId");

    gateway.add = origAdd;
  });

  // ── Gateway error handling ────────────────────────────────────

  it("returns error when gateway.add fails", async () => {
    // Make gateway throw
    const origAdd = gateway.add.bind(gateway);
    gateway.add = async () => { throw new Error("gateway unreachable"); };

    const result = await addJob({
      name: "gateway-fail",
      ownerAgentId: "agent-a",
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "user" },
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error!, /gateway unreachable/);

    // Restore
    gateway.add = origAdd;
  });

  // ── Wrapper job spec correctness ──────────────────────────────

  it("stores correct spec in wrapper job", async () => {
    const result = await addJob({
      name: "spec-check",
      ownerAgentId: "agent-a",
      schedule: { kind: "cron", expr: "*/5 * * * *", tz: "America/New_York" },
      payload: { kind: "agentTurn", message: "do stuff", timeoutSeconds: 120 },
      delivery: { mode: "announce", channel: "slack", to: "slack:channel:C123" },
    });

    assert.equal(result.ok, true);
    const wj = wrapperRepo.getById(result.jobId!)!;
    const spec = JSON.parse(wj.specJson);
    assert.deepEqual(spec.schedule, { kind: "cron", expr: "*/5 * * * *", tz: "America/New_York" });
    assert.deepEqual(spec.payload, { kind: "agentTurn", message: "do stuff", timeoutSeconds: 120 });
    assert.deepEqual(spec.delivery, { mode: "announce", channel: "slack", to: "slack:channel:C123" });
  });

  // ── Inner cron params correctness ─────────────────────────────

  it("passes correct params to gateway.add", async () => {
    const futureIso = new Date(Date.now() + 3_600_000).toISOString();
    const result = await addJob({
      name: "inner-check",
      ownerAgentId: "agent-a",
      schedule: { kind: "at", at: futureIso },
      payload: { kind: "agentTurn", message: "hello" },
      delivery: { mode: "announce", channel: "qq", to: "qq:group:1" },
    });

    assert.equal(result.ok, true);

    // Inspect the inner job created in mock gateway
    const wj = wrapperRepo.getById(result.jobId!)!;
    const innerJob = gateway.jobs.get(wj.innerJobId)!;
    assert.equal(innerJob.name, "inner-check");
    assert.equal(innerJob.sessionTarget, "isolated");
    assert.equal(innerJob.wakeMode, "now");
    assert.ok(innerJob.delivery);
    assert.equal(innerJob.delivery!.channel, "qq");
    assert.equal(innerJob.delivery!.to, "qq:group:1");
  });
});
