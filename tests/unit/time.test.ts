// ── time.ts unit tests ───────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nowMs } from "../../src/util/time.js";

describe("nowMs", () => {
  it("returns a number", () => {
    assert.equal(typeof nowMs(), "number");
  });

  it("returns a value close to Date.now()", () => {
    const before = Date.now();
    const result = nowMs();
    const after = Date.now();
    assert.ok(result >= before, "nowMs should be >= Date.now() before call");
    assert.ok(result <= after, "nowMs should be <= Date.now() after call");
  });

  it("returns finite positive integer-like value", () => {
    const result = nowMs();
    assert.ok(Number.isFinite(result));
    assert.ok(result > 0);
    assert.equal(result, Math.floor(result), "should be an integer (ms precision)");
  });
});
