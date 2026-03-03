// ── Mock IGatewayCronClient for tests ─────────────────────────────────
//
// In-memory store that mimics the real gateway cron.* responses.
// ──────────────────────────────────────────────────────────────────────

import { v7 as uuidv7 } from "uuid";
import type {
  IGatewayCronClient,
} from "../../src/core/gateway-cron.js";
import type {
  InnerCronJob,
  InnerCronListResult,
  InnerCronRunsResult,
  InnerCronRunEntry,
} from "../../src/store/types.js";

export class MockGatewayCronClient implements IGatewayCronClient {
  /** In-memory inner cron job store */
  readonly jobs = new Map<string, InnerCronJob>();
  /** In-memory inner cron run entries */
  readonly runEntries: InnerCronRunEntry[] = [];
  /** Track update calls */
  readonly updateCalls: Array<Record<string, unknown>> = [];
  /** Track remove calls */
  readonly removeCalls: Array<Record<string, unknown>> = [];
  /** Track run calls */
  readonly runCalls: Array<Record<string, unknown>> = [];
  /** If true, list() will throw (used to test degraded get) */
  listShouldThrow = false;

  async add(params: Record<string, unknown>): Promise<InnerCronJob> {
    const now = Date.now();
    const id = `inner-${uuidv7()}`;
    const job: InnerCronJob = {
      id,
      name: (params.name as string) ?? "",
      agentId: (params.agentId as string) ?? undefined,
      enabled: params.enabled !== false,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: (params.schedule as InnerCronJob["schedule"]) ?? { kind: "every", everyMs: 60000 },
      sessionTarget: (params.sessionTarget as string) ?? "isolated",
      wakeMode: (params.wakeMode as string) ?? "now",
      payload: (params.payload as InnerCronJob["payload"]) ?? { kind: "agentTurn", message: "" },
      delivery: params.delivery as InnerCronJob["delivery"],
      state: {
        nextRunAtMs: now + 60000,
        lastRunAtMs: 0,
        lastStatus: "none",
        consecutiveErrors: 0,
      },
    };
    this.jobs.set(id, job);
    return job;
  }

  async list(params?: Record<string, unknown>): Promise<InnerCronListResult> {
    if (this.listShouldThrow) throw new Error("Mock: gateway list unavailable");
    const limit = (params?.limit as number) ?? 50;
    const offset = (params?.offset as number) ?? 0;
    const allJobs = Array.from(this.jobs.values());
    const sliced = allJobs.slice(offset, offset + limit);
    return {
      jobs: sliced,
      total: allJobs.length,
      offset,
      limit,
      hasMore: offset + limit < allJobs.length,
      nextOffset: offset + limit < allJobs.length ? offset + limit : null,
    };
  }

  async update(params: Record<string, unknown>): Promise<InnerCronJob> {
    this.updateCalls.push(params);
    const id = (params.jobId ?? params.id) as string;
    const existing = this.jobs.get(id);
    if (!existing) {
      throw new Error(`Mock: inner cron job '${id}' not found`);
    }
    const updated = { ...existing, updatedAtMs: Date.now() };
    // Support new { jobId, patch } shape
    const patch = (params.patch ?? {}) as Record<string, unknown>;
    if (patch.name !== undefined) updated.name = patch.name as string;
    if (patch.enabled !== undefined) updated.enabled = patch.enabled as boolean;
    if (patch.schedule !== undefined) updated.schedule = patch.schedule as InnerCronJob["schedule"];
    if (patch.payload !== undefined) updated.payload = patch.payload as InnerCronJob["payload"];
    if (patch.delivery !== undefined) updated.delivery = patch.delivery as InnerCronJob["delivery"];
    this.jobs.set(id, updated);
    return updated;
  }

  async remove(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = (params.jobId ?? params.id) as string;
    this.removeCalls.push(params);
    this.jobs.delete(id);
    return { ok: true, deleted: id };
  }

  async run(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = (params.jobId ?? params.id) as string;
    this.runCalls.push(params);
    const entry: InnerCronRunEntry = {
      runId: `run-${uuidv7()}`,
      jobId: id,
      startedAtMs: Date.now(),
      status: "triggered",
    };
    this.runEntries.push(entry);
    return { ok: true, triggered: id, runId: entry.runId };
  }

  async runs(params?: Record<string, unknown>): Promise<InnerCronRunsResult> {
    const limit = (params?.limit as number) ?? 50;
    const offset = (params?.offset as number) ?? 0;
    let entries = this.runEntries;
    if (params?.jobId) {
      entries = entries.filter((r) => r.jobId === params.jobId);
    }
    const sliced = entries.slice(offset, offset + limit);
    return {
      entries: sliced,
      total: entries.length,
      offset,
      limit,
      hasMore: offset + limit < entries.length,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    };
  }
}
