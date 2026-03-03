// ── ACL unit tests ───────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAccess, isAdmin } from "../../src/acl.js";
import type { AgentCronConfig } from "../../src/config.js";

const baseConfig: AgentCronConfig = {
  storePath: "/tmp/test",
  defaultTz: "UTC",
  adminAgentIds: ["main", "admin-bot"],
  maxJobsPerAgent: 100,
  minIntervalSeconds: 60,
  maxTimeoutSeconds: 600,
  gateway: { openclawBin: "openclaw", timeoutMs: 15000 },
  audit: { enabled: true, retentionDays: 90 },
};

describe("ACL", () => {
  it("admin can access any agent's jobs", () => {
    const result = canAccess("main", "get", "other-agent", baseConfig);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "admin");
  });

  it("second admin can also cross-access", () => {
    const result = canAccess("admin-bot", "remove", "agent-x", baseConfig);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "admin");
  });

  it("non-admin can access own jobs", () => {
    const result = canAccess("agent-a", "get", "agent-a", baseConfig);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "owner");
  });

  it("non-admin CANNOT access other agent's jobs", () => {
    const result = canAccess("agent-a", "get", "agent-b", baseConfig);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /agent-a.*cannot.*get.*agent-b/);
  });

  it("non-admin CANNOT update other agent's jobs", () => {
    const result = canAccess("agent-a", "update", "agent-b", baseConfig);
    assert.equal(result.allowed, false);
  });

  it("non-admin CANNOT remove other agent's jobs", () => {
    const result = canAccess("agent-a", "remove", "agent-b", baseConfig);
    assert.equal(result.allowed, false);
  });

  it("isAdmin returns true for admin agents", () => {
    assert.equal(isAdmin("main", baseConfig), true);
    assert.equal(isAdmin("admin-bot", baseConfig), true);
  });

  it("isAdmin returns false for non-admin agents", () => {
    assert.equal(isAdmin("agent-a", baseConfig), false);
    assert.equal(isAdmin("unknown", baseConfig), false);
  });
});
