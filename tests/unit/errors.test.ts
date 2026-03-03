// ── errors.ts unit tests ─────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AgentCronError,
  aclDeny,
  notFound,
  validationError,
  quotaExceeded,
  internalError,
  errorResult,
} from "../../src/util/errors.js";

describe("AgentCronError", () => {
  it("sets code, message, and name correctly", () => {
    const err = new AgentCronError("ACL_DENY", "forbidden", { foo: "bar" });
    assert.equal(err.code, "ACL_DENY");
    assert.equal(err.message, "forbidden");
    assert.equal(err.name, "AgentCronError");
    assert.deepEqual(err.details, { foo: "bar" });
  });

  it("extends Error", () => {
    const err = new AgentCronError("NOT_FOUND", "missing");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AgentCronError);
  });

  it("works without details", () => {
    const err = new AgentCronError("INTERNAL_ERROR", "oops");
    assert.equal(err.details, undefined);
  });
});

describe("aclDeny", () => {
  it("creates ACL_DENY error with actor/action/target in message", () => {
    const err = aclDeny("agent-b", "get", "agent-a");
    assert.equal(err.code, "ACL_DENY");
    assert.match(err.message, /agent-b/);
    assert.match(err.message, /get/);
    assert.match(err.message, /agent-a/);
    assert.deepEqual(err.details, { actor: "agent-b", action: "get", target: "agent-a" });
  });
});

describe("notFound", () => {
  it("creates NOT_FOUND error with entity and id", () => {
    const err = notFound("Job", "abc-123");
    assert.equal(err.code, "NOT_FOUND");
    assert.match(err.message, /Job/);
    assert.match(err.message, /abc-123/);
    assert.deepEqual(err.details, { entity: "Job", id: "abc-123" });
  });
});

describe("validationError", () => {
  it("creates VALIDATION_ERROR with message", () => {
    const err = validationError("bad input");
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.equal(err.message, "bad input");
    assert.equal(err.details, undefined);
  });

  it("creates VALIDATION_ERROR with details", () => {
    const err = validationError("bad field", { field: "name" });
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.deepEqual(err.details, { field: "name" });
  });
});

describe("quotaExceeded", () => {
  it("creates QUOTA_EXCEEDED error", () => {
    const err = quotaExceeded("too many jobs", { current: 100, max: 100 });
    assert.equal(err.code, "QUOTA_EXCEEDED");
    assert.equal(err.message, "too many jobs");
    assert.deepEqual(err.details, { current: 100, max: 100 });
  });
});

describe("internalError", () => {
  it("creates INTERNAL_ERROR", () => {
    const err = internalError("something broke", { trace: "xyz" });
    assert.equal(err.code, "INTERNAL_ERROR");
    assert.equal(err.message, "something broke");
    assert.deepEqual(err.details, { trace: "xyz" });
  });
});

describe("errorResult", () => {
  it("formats AgentCronError into structured tool result", () => {
    const err = new AgentCronError("NOT_FOUND", "Job not found", { id: "j1" });
    const result = errorResult(err);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, "NOT_FOUND");
    assert.equal(parsed.message, "Job not found");
    assert.deepEqual(parsed.details, { id: "j1" });
  });

  it("formats generic Error into INTERNAL_ERROR", () => {
    const err = new Error("something failed");
    const result = errorResult(err);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, "INTERNAL_ERROR");
    assert.equal(parsed.message, "something failed");
  });

  it("formats non-Error value into INTERNAL_ERROR", () => {
    const result = errorResult("raw string error");
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, "INTERNAL_ERROR");
    assert.equal(parsed.message, "raw string error");
  });

  it("formats number into INTERNAL_ERROR", () => {
    const result = errorResult(42);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, "INTERNAL_ERROR");
    assert.equal(parsed.message, "42");
  });

  it("formats null into INTERNAL_ERROR", () => {
    const result = errorResult(null);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, "INTERNAL_ERROR");
    assert.equal(parsed.message, "null");
  });

  it("formats undefined into INTERNAL_ERROR", () => {
    const result = errorResult(undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.error, "INTERNAL_ERROR");
    assert.equal(parsed.message, "undefined");
  });

  it("does not include details for non-AgentCronError", () => {
    const result = errorResult(new Error("boom"));
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.details, undefined);
  });
});
