// ── redaction unit tests ──────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSensitive } from "../../src/util/redact.js";

describe("redactSensitive", () => {
  it("redacts token at top level", () => {
    const input = { token: "abc123", name: "test" };
    const result = redactSensitive(input) as Record<string, unknown>;
    assert.equal(result.token, "***REDACTED***");
    assert.equal(result.name, "test");
  });

  it("redacts password (case-insensitive key match)", () => {
    const input = { Password: "secret", data: 42 };
    const result = redactSensitive(input) as Record<string, unknown>;
    assert.equal(result.Password, "***REDACTED***");
    assert.equal(result.data, 42);
  });

  it("redacts apiKey regardless of casing", () => {
    const input = { apiKey: "key-value", ApiKey: "key2", APIKEY: "key3" };
    const result = redactSensitive(input) as Record<string, unknown>;
    assert.equal(result.apiKey, "***REDACTED***");
    assert.equal(result.ApiKey, "***REDACTED***");
    assert.equal(result.APIKEY, "***REDACTED***");
  });

  it("redacts api_key", () => {
    const input = { api_key: "sk-123" };
    const result = redactSensitive(input) as Record<string, unknown>;
    assert.equal(result.api_key, "***REDACTED***");
  });

  it("redacts authorization header", () => {
    const input = { authorization: "Bearer xyz" };
    const result = redactSensitive(input) as Record<string, unknown>;
    assert.equal(result.authorization, "***REDACTED***");
  });

  it("recursively redacts nested objects", () => {
    const input = {
      config: {
        secret: "hidden",
        host: "localhost",
      },
      name: "job1",
    };
    const result = redactSensitive(input) as Record<string, Record<string, unknown>>;
    assert.equal(result.config.secret, "***REDACTED***");
    assert.equal(result.config.host, "localhost");
    assert.equal((result as Record<string, unknown>).name, "job1");
  });

  it("handles arrays", () => {
    const input = [{ token: "a" }, { name: "b" }];
    const result = redactSensitive(input) as Array<Record<string, unknown>>;
    assert.equal(result[0].token, "***REDACTED***");
    assert.equal(result[1].name, "b");
  });

  it("returns primitives unchanged", () => {
    assert.equal(redactSensitive("hello"), "hello");
    assert.equal(redactSensitive(42), 42);
    assert.equal(redactSensitive(null), null);
    assert.equal(redactSensitive(undefined), undefined);
  });

  it("preserves non-sensitive keys", () => {
    const input = { jobId: "j1", ownerAgentId: "agent-1", status: "ok" };
    const result = redactSensitive(input) as Record<string, unknown>;
    assert.deepEqual(result, input);
  });
});
