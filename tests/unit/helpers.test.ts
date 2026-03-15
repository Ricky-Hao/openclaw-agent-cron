// ── helpers.ts unit tests ─────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  jsonResult,
  scheduleToInner,
  innerScheduleToUserFacing,
  payloadToInner,
  deliveryToInner,
  wrapperJobToJson,
  buildSchedule,
  buildPayload,
  buildDelivery,
  validateTimeout,
  validateDelivery,
} from "../../src/tools/helpers.js";
import type { AgentCronConfig } from "../../src/config.js";
import type { WrapperJob, InnerCronJob, Schedule, Payload, Delivery } from "../../src/store/types.js";

const baseConfig: AgentCronConfig = {
  storePath: "/tmp/test",
  defaultTz: "UTC",
  adminAgentIds: ["main"],
  maxJobsPerAgent: 100,
  minIntervalSeconds: 60,
  maxTimeoutSeconds: 600,
  gateway: { openclawBin: "openclaw", timeoutMs: 15000 },
  audit: { enabled: true, retentionDays: 90 },
};

// ── jsonResult ──────────────────────────────────────────────────────

describe("jsonResult", () => {
  it("wraps data as JSON text content", () => {
    const result = jsonResult({ ok: true, value: 42 });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, 42);
  });

  it("pretty-prints with 2-space indent", () => {
    const result = jsonResult({ a: 1 });
    assert.ok(result.content[0].text.includes("\n"));
    assert.ok(result.content[0].text.includes("  "));
  });

  it("handles null", () => {
    const result = jsonResult(null);
    assert.equal(JSON.parse(result.content[0].text), null);
  });

  it("handles arrays", () => {
    const result = jsonResult([1, 2, 3]);
    assert.deepEqual(JSON.parse(result.content[0].text), [1, 2, 3]);
  });

  it("handles strings", () => {
    const result = jsonResult("hello");
    assert.equal(JSON.parse(result.content[0].text), "hello");
  });
});

// ── scheduleToInner ─────────────────────────────────────────────────

describe("scheduleToInner", () => {
  it("converts 'at' schedule with epoch ms", () => {
    const s: Schedule = { kind: "at", at: 1700000000000 };
    const inner = scheduleToInner(s, "UTC");
    assert.equal(inner.kind, "at");
    assert.equal(inner.atMs, 1700000000000);
  });

  it("converts 'at' schedule with ISO-8601 string", () => {
    const s: Schedule = { kind: "at", at: "2025-01-01T00:00:00Z" };
    const inner = scheduleToInner(s, "UTC");
    assert.equal(inner.kind, "at");
    assert.equal(inner.atMs, new Date("2025-01-01T00:00:00Z").getTime());
  });

  it("throws on invalid 'at' value (NaN date string)", () => {
    const s: Schedule = { kind: "at", at: "not-a-date" };
    assert.throws(() => scheduleToInner(s, "UTC"), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      return true;
    });
  });

  it("throws on 'at' value of 0", () => {
    const s: Schedule = { kind: "at", at: 0 };
    assert.throws(() => scheduleToInner(s, "UTC"), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      return true;
    });
  });

  it("throws on 'at' value of negative number", () => {
    const s: Schedule = { kind: "at", at: -1000 };
    assert.throws(() => scheduleToInner(s, "UTC"), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      return true;
    });
  });

  it("converts 'every' schedule", () => {
    const s: Schedule = { kind: "every", intervalSeconds: 300 };
    const inner = scheduleToInner(s, "UTC");
    assert.equal(inner.kind, "every");
    assert.equal(inner.everyMs, 300_000);
    assert.equal(inner.anchorMs, undefined);
  });

  it("converts 'every' schedule with string anchor", () => {
    const s: Schedule = { kind: "every", intervalSeconds: 60, anchor: "2025-01-01T00:00:00Z" };
    const inner = scheduleToInner(s, "UTC");
    assert.equal(inner.kind, "every");
    assert.equal(inner.everyMs, 60_000);
    assert.equal(inner.anchorMs, new Date("2025-01-01T00:00:00Z").getTime());
  });

  it("converts 'every' schedule with numeric anchor", () => {
    const s: Schedule = { kind: "every", intervalSeconds: 120, anchor: 1700000000000 };
    const inner = scheduleToInner(s, "UTC");
    assert.equal(inner.anchorMs, 1700000000000);
  });

  it("converts 'cron' schedule with tz", () => {
    const s: Schedule = { kind: "cron", expr: "0 9 * * 1-5", tz: "Asia/Shanghai" };
    const inner = scheduleToInner(s, "UTC");
    assert.equal(inner.kind, "cron");
    assert.equal(inner.expr, "0 9 * * 1-5");
    assert.equal(inner.tz, "Asia/Shanghai");
  });

  it("converts 'cron' schedule without tz uses defaultTz", () => {
    const s: Schedule = { kind: "cron", expr: "*/5 * * * *" };
    const inner = scheduleToInner(s, "America/New_York");
    assert.equal(inner.tz, "America/New_York");
  });

  it("throws on unknown schedule kind", () => {
    const s = { kind: "banana" } as any;
    assert.throws(() => scheduleToInner(s, "UTC"), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /banana/);
      return true;
    });
  });
});

// ── innerScheduleToUserFacing ───────────────────────────────────────

describe("innerScheduleToUserFacing", () => {
  it("converts inner 'at' schedule", () => {
    const inner = { kind: "at" as const, atMs: 1700000000000 };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "at");
    assert.equal((uf as any).at, 1700000000000);
  });

  it("converts inner 'at' schedule with missing atMs", () => {
    const inner = { kind: "at" as const };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "at");
    assert.equal((uf as any).at, 0);
  });

  it("converts inner 'every' schedule", () => {
    const inner = { kind: "every" as const, everyMs: 300_000, anchorMs: 1700000000000 };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "every");
    assert.equal((uf as any).intervalSeconds, 300);
    assert.equal((uf as any).anchor, 1700000000000);
  });

  it("converts inner 'every' schedule with missing everyMs", () => {
    const inner = { kind: "every" as const };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "every");
    assert.equal((uf as any).intervalSeconds, 0);
  });

  it("converts inner 'cron' schedule", () => {
    const inner = { kind: "cron" as const, expr: "*/5 * * * *", tz: "UTC" };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "cron");
    assert.equal((uf as any).expr, "*/5 * * * *");
    assert.equal((uf as any).tz, "UTC");
  });

  it("converts inner 'cron' schedule with missing expr", () => {
    const inner = { kind: "cron" as const };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "cron");
    assert.equal((uf as any).expr, "");
  });

  it("handles unknown kind by returning default cron", () => {
    const inner = { kind: "banana" as any };
    const uf = innerScheduleToUserFacing(inner);
    assert.equal(uf.kind, "cron");
    assert.equal((uf as any).expr, "unknown");
  });
});

// ── payloadToInner ──────────────────────────────────────────────────

describe("payloadToInner", () => {
  it("converts agentTurn payload without timeoutSeconds", () => {
    const p: Payload = { kind: "agentTurn", message: "hello" };
    const inner = payloadToInner(p);
    assert.equal(inner.kind, "agentTurn");
    assert.equal(inner.message, "hello");
    assert.equal(inner.timeoutSeconds, undefined);
  });

  it("converts agentTurn payload with timeoutSeconds", () => {
    const p: Payload = { kind: "agentTurn", message: "hello", timeoutSeconds: 120 };
    const inner = payloadToInner(p);
    assert.equal(inner.kind, "agentTurn");
    assert.equal(inner.message, "hello");
    assert.equal(inner.timeoutSeconds, 120);
  });
});

// ── deliveryToInner ─────────────────────────────────────────────────

describe("deliveryToInner", () => {
  it("converts full delivery", () => {
    const d: Delivery = { mode: "announce", channel: "qq", to: "user-1" };
    const inner = deliveryToInner(d);
    assert.equal(inner.mode, "announce");
    assert.equal(inner.channel, "qq");
    assert.equal(inner.to, "user-1");
  });

  it("omits undefined fields", () => {
    const d: Delivery = { mode: "announce" };
    const inner = deliveryToInner(d);
    assert.equal(inner.mode, "announce");
    assert.ok(!("channel" in inner));
    assert.ok(!("to" in inner));
  });

  it("converts delivery with mode=none", () => {
    const d: Delivery = { mode: "none" };
    const inner = deliveryToInner(d);
    assert.equal(inner.mode, "none");
  });

  it("returns empty object when all fields are undefined", () => {
    const d: Delivery = {};
    const inner = deliveryToInner(d);
    assert.deepEqual(inner, {});
  });
});

// ── buildSchedule ───────────────────────────────────────────────────

describe("buildSchedule", () => {
  it("builds 'at' schedule", () => {
    const s = buildSchedule({ kind: "at", at: 12345 });
    assert.equal(s.kind, "at");
    assert.equal((s as any).at, 12345);
  });

  it("builds 'every' schedule", () => {
    const s = buildSchedule({ kind: "every", intervalSeconds: 300, anchor: "2025-01-01" });
    assert.equal(s.kind, "every");
    assert.equal((s as any).intervalSeconds, 300);
    assert.equal((s as any).anchor, "2025-01-01");
  });

  it("builds 'every' schedule without anchor", () => {
    const s = buildSchedule({ kind: "every", intervalSeconds: 120 });
    assert.equal(s.kind, "every");
    assert.equal((s as any).anchor, undefined);
  });

  it("builds 'cron' schedule", () => {
    const s = buildSchedule({ kind: "cron", expr: "* * * * *", tz: "UTC" });
    assert.equal(s.kind, "cron");
    assert.equal((s as any).expr, "* * * * *");
    assert.equal((s as any).tz, "UTC");
  });

  it("builds 'cron' schedule without tz", () => {
    const s = buildSchedule({ kind: "cron", expr: "0 0 * * *" });
    assert.equal(s.kind, "cron");
    assert.equal((s as any).tz, undefined);
  });

  it("throws on unknown schedule kind", () => {
    assert.throws(() => buildSchedule({ kind: "mystery" }), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /mystery/);
      return true;
    });
  });
});

// ── buildPayload ────────────────────────────────────────────────────

describe("buildPayload", () => {
  it("builds agentTurn payload", () => {
    const p = buildPayload({ kind: "agentTurn", message: "hi", timeoutSeconds: 30 });
    assert.equal(p.kind, "agentTurn");
    assert.equal(p.message, "hi");
    assert.equal(p.timeoutSeconds, 30);
  });

  it("builds agentTurn payload without timeoutSeconds", () => {
    const p = buildPayload({ kind: "agentTurn", message: "test" });
    assert.equal(p.kind, "agentTurn");
    assert.equal(p.message, "test");
    assert.equal(p.timeoutSeconds, undefined);
  });

  it("throws on unknown payload kind", () => {
    assert.throws(() => buildPayload({ kind: "systemEvent", event: "ping" }), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /systemEvent/);
      return true;
    });
  });
});

// ── buildDelivery ───────────────────────────────────────────────────

describe("buildDelivery", () => {
  it("builds delivery with all fields", () => {
    const d = buildDelivery({ mode: "announce", channel: "qq", to: "user" });
    assert.equal(d.mode, "announce");
    assert.equal(d.channel, "qq");
    assert.equal(d.to, "user");
  });

  it("builds delivery with optional fields missing", () => {
    const d = buildDelivery({ mode: "none" });
    assert.equal(d.mode, "none");
    assert.equal(d.channel, undefined);
    assert.equal(d.to, undefined);
  });

  it("builds delivery from empty object", () => {
    const d = buildDelivery({});
    assert.equal(d.mode, undefined);
    assert.equal(d.channel, undefined);
    assert.equal(d.to, undefined);
  });
});

// ── validateTimeout ─────────────────────────────────────────────────

describe("validateTimeout", () => {
  it("passes when timeoutSeconds is within range", () => {
    const p: Payload = { kind: "agentTurn", message: "x", timeoutSeconds: 300 };
    assert.doesNotThrow(() => validateTimeout(p, baseConfig));
  });

  it("passes when timeoutSeconds is exactly 1", () => {
    const p: Payload = { kind: "agentTurn", message: "x", timeoutSeconds: 1 };
    assert.doesNotThrow(() => validateTimeout(p, baseConfig));
  });

  it("passes when timeoutSeconds equals maxTimeoutSeconds", () => {
    const p: Payload = { kind: "agentTurn", message: "x", timeoutSeconds: 600 };
    assert.doesNotThrow(() => validateTimeout(p, baseConfig));
  });

  it("passes when timeoutSeconds is not provided", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    assert.doesNotThrow(() => validateTimeout(p, baseConfig));
  });

  it("throws when timeoutSeconds exceeds maxTimeoutSeconds", () => {
    const p: Payload = { kind: "agentTurn", message: "x", timeoutSeconds: 601 };
    assert.throws(() => validateTimeout(p, baseConfig), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /timeoutSeconds/);
      return true;
    });
  });

  it("throws when timeoutSeconds is 0", () => {
    const p: Payload = { kind: "agentTurn", message: "x", timeoutSeconds: 0 };
    assert.throws(() => validateTimeout(p, baseConfig), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      return true;
    });
  });

  it("throws when timeoutSeconds is negative", () => {
    const p: Payload = { kind: "agentTurn", message: "x", timeoutSeconds: -10 };
    assert.throws(() => validateTimeout(p, baseConfig), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      return true;
    });
  });
});

// ── validateDelivery ────────────────────────────────────────────────

describe("validateDelivery", () => {
  it("passes with valid announce delivery", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", channel: "qq", to: "user" };
    assert.doesNotThrow(() => validateDelivery(p, d));
  });

  it("throws when delivery is undefined for agentTurn", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    assert.throws(() => validateDelivery(p, undefined), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /delivery is required/);
      return true;
    });
  });

  it("allows mode 'none' for agentTurn", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "none", channel: "ch", to: "user" };
    assert.doesNotThrow(() => validateDelivery(p, d));
  });

  it("throws when mode is invalid for agentTurn", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "webhook" as any, channel: "ch", to: "user" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /announce.*none/);
      return true;
    });
  });

  it("throws when mode is undefined for agentTurn", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { channel: "ch", to: "user" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /announce/);
      return true;
    });
  });

  it("throws when channel is empty", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", channel: "", to: "user" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /channel/);
      return true;
    });
  });

  it("throws when channel is whitespace-only", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", channel: "   ", to: "user" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /channel/);
      return true;
    });
  });

  it("throws when channel is undefined", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", to: "user" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /channel/);
      return true;
    });
  });

  it("throws when to is empty", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", channel: "ch", to: "" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /delivery\.to/);
      return true;
    });
  });

  it("throws when to is whitespace-only", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", channel: "ch", to: "   " };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /delivery\.to/);
      return true;
    });
  });

  it("throws when to is undefined", () => {
    const p: Payload = { kind: "agentTurn", message: "x" };
    const d: Delivery = { mode: "announce", channel: "ch" };
    assert.throws(() => validateDelivery(p, d), (err: any) => {
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.match(err.message, /delivery\.to/);
      return true;
    });
  });
});

// ── wrapperJobToJson ────────────────────────────────────────────────

describe("wrapperJobToJson", () => {
  function makeWj(specOverrides?: Record<string, unknown>): WrapperJob {
    const spec = {
      schedule: { kind: "every", intervalSeconds: 300 },
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "ch", to: "user" },
      ...specOverrides,
    };
    return {
      id: "wj-1",
      ownerAgentId: "agent-a",
      innerJobId: "inner-1",
      name: "test-job",
      specJson: JSON.stringify(spec),
      createdAtMs: 1000,
      updatedAtMs: 2000,
      deletedAtMs: null,
    };
  }

  it("serializes wrapper job without inner cron state", () => {
    const json = wrapperJobToJson(makeWj());
    assert.equal(json.id, "wj-1");
    assert.equal(json.name, "test-job");
    assert.equal(json.ownerAgentId, "agent-a");
    assert.equal(json.createdAtMs, 1000);
    assert.equal(json.updatedAtMs, 2000);
    assert.deepEqual((json.schedule as any).kind, "every");
    assert.deepEqual((json.payload as any).kind, "agentTurn");
    assert.equal(json.enabled, undefined);
    assert.equal(json.state, undefined);
  });

  it("serializes wrapper job with inner cron state", () => {
    const inner: InnerCronJob = {
      id: "inner-1",
      name: "test-job",
      enabled: true,
      createdAtMs: 1000,
      updatedAtMs: 2000,
      schedule: { kind: "every", everyMs: 300000 },
      sessionTarget: "isolated",
      payload: { kind: "agentTurn", message: "test" },
      state: {
        nextRunAtMs: 5000,
        lastRunAtMs: 3000,
        lastRunStatus: "ok",
        consecutiveErrors: 0,
      },
    };
    const json = wrapperJobToJson(makeWj(), inner);
    assert.equal(json.enabled, true);
    const state = json.state as Record<string, unknown>;
    assert.equal(state.nextRunAtMs, 5000);
    assert.equal(state.lastRunAtMs, 3000);
    assert.equal(state.lastStatus, "ok");
    assert.equal(state.consecutiveErrors, 0);
  });

  it("handles null inner", () => {
    const json = wrapperJobToJson(makeWj(), null);
    assert.equal(json.enabled, undefined);
    assert.equal(json.state, undefined);
  });

  it("handles inner with lastStatus fallback (no lastRunStatus)", () => {
    const inner: InnerCronJob = {
      id: "inner-1",
      name: "test",
      enabled: false,
      createdAtMs: 0,
      updatedAtMs: 0,
      schedule: { kind: "every", everyMs: 60000 },
      sessionTarget: "isolated",
      payload: { kind: "agentTurn", message: "" },
      state: {
        nextRunAtMs: 0,
        lastStatus: "error",
        consecutiveErrors: 3,
      },
    };
    const json = wrapperJobToJson(makeWj(), inner);
    const state = json.state as Record<string, unknown>;
    assert.equal(state.lastStatus, "error");
    assert.equal(state.consecutiveErrors, 3);
  });

  it("handles malformed specJson gracefully", () => {
    const wj: WrapperJob = {
      id: "wj-bad",
      ownerAgentId: "agent-a",
      innerJobId: "inner-bad",
      name: "bad-spec",
      specJson: "not-json{{{",
      createdAtMs: 0,
      updatedAtMs: 0,
      deletedAtMs: null,
    };
    const json = wrapperJobToJson(wj);
    assert.equal(json.id, "wj-bad");
    assert.equal(json.schedule, null);
    assert.equal(json.payload, null);
    assert.equal(json.delivery, null);
  });
});
