// ── Shared test config ────────────────────────────────────────────────

import type { AgentCronConfig } from "../../src/config.js";

export const testConfig: AgentCronConfig = {
  storePath: "/tmp/test",
  defaultTz: "UTC",
  adminAgentIds: ["main"],
  maxJobsPerAgent: 100,
  minIntervalSeconds: 60,
  maxTimeoutSeconds: 600,
  gateway: { openclawBin: "openclaw", timeoutMs: 15000 },
  audit: { enabled: true, retentionDays: 90 },
};

export function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}
