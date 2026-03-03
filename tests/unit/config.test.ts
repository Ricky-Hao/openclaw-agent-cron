// ── resolveConfig unit tests ──────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../../src/config.js";

describe("resolveConfig", () => {
  const fallbackPath = "/tmp/fallback";

  it("returns all defaults when raw is undefined", () => {
    const cfg = resolveConfig(undefined, fallbackPath);
    assert.equal(cfg.storePath, fallbackPath);
    assert.equal(cfg.defaultTz, "UTC");
    assert.deepEqual(cfg.adminAgentIds, ["main"]);
    assert.equal(cfg.maxJobsPerAgent, 100);
    assert.equal(cfg.minIntervalSeconds, 60);
    assert.equal(cfg.maxTimeoutSeconds, 600);
    assert.equal(cfg.gateway.openclawBin, "openclaw");
    assert.equal(cfg.gateway.timeoutMs, 15_000);
    assert.equal(cfg.audit.enabled, true);
    assert.equal(cfg.audit.retentionDays, 90);
  });

  it("returns all defaults when raw is empty object", () => {
    const cfg = resolveConfig({}, fallbackPath);
    assert.equal(cfg.storePath, fallbackPath);
    assert.equal(cfg.defaultTz, "UTC");
  });

  it("uses storePath from raw when provided", () => {
    const cfg = resolveConfig({ storePath: "/custom/path" }, fallbackPath);
    assert.equal(cfg.storePath, "/custom/path");
  });

  it("falls back to fallbackStorePath when storePath is empty string", () => {
    const cfg = resolveConfig({ storePath: "" }, fallbackPath);
    assert.equal(cfg.storePath, fallbackPath);
  });

  it("falls back to fallbackStorePath when storePath is not a string", () => {
    const cfg = resolveConfig({ storePath: 123 }, fallbackPath);
    assert.equal(cfg.storePath, fallbackPath);
  });

  it("uses defaultTz from raw when provided", () => {
    const cfg = resolveConfig({ defaultTz: "Asia/Shanghai" }, fallbackPath);
    assert.equal(cfg.defaultTz, "Asia/Shanghai");
  });

  it("falls back to UTC when defaultTz is not a string", () => {
    const cfg = resolveConfig({ defaultTz: 42 }, fallbackPath);
    assert.equal(cfg.defaultTz, "UTC");
  });

  it("uses adminAgentIds from raw when provided as array", () => {
    const cfg = resolveConfig({ adminAgentIds: ["a", "b"] }, fallbackPath);
    assert.deepEqual(cfg.adminAgentIds, ["a", "b"]);
  });

  it("converts non-string adminAgentIds elements to strings", () => {
    const cfg = resolveConfig({ adminAgentIds: [1, true, "x"] }, fallbackPath);
    assert.deepEqual(cfg.adminAgentIds, ["1", "true", "x"]);
  });

  it("falls back to default adminAgentIds when not an array", () => {
    const cfg = resolveConfig({ adminAgentIds: "main" }, fallbackPath);
    assert.deepEqual(cfg.adminAgentIds, ["main"]);
  });

  it("uses maxJobsPerAgent from raw when valid positive number", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: 50 }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 50);
  });

  it("truncates fractional maxJobsPerAgent", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: 75.9 }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 75);
  });

  it("falls back to default maxJobsPerAgent for zero", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: 0 }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 100);
  });

  it("falls back to default maxJobsPerAgent for negative", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: -10 }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 100);
  });

  it("falls back to default maxJobsPerAgent for NaN", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: NaN }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 100);
  });

  it("falls back to default maxJobsPerAgent for Infinity", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: Infinity }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 100);
  });

  it("falls back to default maxJobsPerAgent for non-number", () => {
    const cfg = resolveConfig({ maxJobsPerAgent: "50" }, fallbackPath);
    assert.equal(cfg.maxJobsPerAgent, 100);
  });

  it("uses minIntervalSeconds from raw", () => {
    const cfg = resolveConfig({ minIntervalSeconds: 30 }, fallbackPath);
    assert.equal(cfg.minIntervalSeconds, 30);
  });

  it("uses maxTimeoutSeconds from raw", () => {
    const cfg = resolveConfig({ maxTimeoutSeconds: 1200 }, fallbackPath);
    assert.equal(cfg.maxTimeoutSeconds, 1200);
  });

  // ── Gateway sub-config ───────────────────────────────────────────

  it("uses gateway.openclawBin from raw when provided", () => {
    const cfg = resolveConfig({ gateway: { openclawBin: "/usr/bin/oc" } }, fallbackPath);
    assert.equal(cfg.gateway.openclawBin, "/usr/bin/oc");
  });

  it("falls back to default openclawBin when gateway.openclawBin is empty", () => {
    const cfg = resolveConfig({ gateway: { openclawBin: "" } }, fallbackPath);
    assert.equal(cfg.gateway.openclawBin, "openclaw");
  });

  it("falls back to default openclawBin when not a string", () => {
    const cfg = resolveConfig({ gateway: { openclawBin: 42 } }, fallbackPath);
    assert.equal(cfg.gateway.openclawBin, "openclaw");
  });

  it("uses gateway.timeoutMs from raw when valid", () => {
    const cfg = resolveConfig({ gateway: { timeoutMs: 30_000 } }, fallbackPath);
    assert.equal(cfg.gateway.timeoutMs, 30_000);
  });

  it("falls back to default timeoutMs for invalid value", () => {
    const cfg = resolveConfig({ gateway: { timeoutMs: -1 } }, fallbackPath);
    assert.equal(cfg.gateway.timeoutMs, 15_000);
  });

  it("uses default gateway when gateway is not provided", () => {
    const cfg = resolveConfig({}, fallbackPath);
    assert.equal(cfg.gateway.openclawBin, "openclaw");
    assert.equal(cfg.gateway.timeoutMs, 15_000);
  });

  // ── Audit sub-config ─────────────────────────────────────────────

  it("uses audit.enabled from raw when boolean", () => {
    const cfg = resolveConfig({ audit: { enabled: false } }, fallbackPath);
    assert.equal(cfg.audit.enabled, false);
  });

  it("falls back to default audit.enabled when not boolean", () => {
    const cfg = resolveConfig({ audit: { enabled: "yes" } }, fallbackPath);
    assert.equal(cfg.audit.enabled, true);
  });

  it("uses audit.retentionDays from raw when valid", () => {
    const cfg = resolveConfig({ audit: { retentionDays: 30 } }, fallbackPath);
    assert.equal(cfg.audit.retentionDays, 30);
  });

  it("falls back to default retentionDays for invalid value", () => {
    const cfg = resolveConfig({ audit: { retentionDays: 0 } }, fallbackPath);
    assert.equal(cfg.audit.retentionDays, 90);
  });

  it("uses default audit when audit is not provided", () => {
    const cfg = resolveConfig({}, fallbackPath);
    assert.equal(cfg.audit.enabled, true);
    assert.equal(cfg.audit.retentionDays, 90);
  });

  // ── Full custom config ───────────────────────────────────────────

  it("fully overrides all values", () => {
    const cfg = resolveConfig(
      {
        storePath: "/data/cron",
        defaultTz: "America/New_York",
        adminAgentIds: ["super-admin"],
        maxJobsPerAgent: 200,
        minIntervalSeconds: 120,
        maxTimeoutSeconds: 3600,
        gateway: { openclawBin: "/opt/oc", timeoutMs: 5000 },
        audit: { enabled: false, retentionDays: 7 },
      },
      fallbackPath,
    );
    assert.equal(cfg.storePath, "/data/cron");
    assert.equal(cfg.defaultTz, "America/New_York");
    assert.deepEqual(cfg.adminAgentIds, ["super-admin"]);
    assert.equal(cfg.maxJobsPerAgent, 200);
    assert.equal(cfg.minIntervalSeconds, 120);
    assert.equal(cfg.maxTimeoutSeconds, 3600);
    assert.equal(cfg.gateway.openclawBin, "/opt/oc");
    assert.equal(cfg.gateway.timeoutMs, 5000);
    assert.equal(cfg.audit.enabled, false);
    assert.equal(cfg.audit.retentionDays, 7);
  });
});
