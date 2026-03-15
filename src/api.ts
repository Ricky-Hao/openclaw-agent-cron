// ── Programmatic API for cross-plugin use ────────────────────────────
//
// Allows other plugins in the same process to create cron jobs without
// going through the tool layer.  Requires that the agent-cron plugin
// has been initialized (DB + gateway client) via its service start().
// ─────────────────────────────────────────────────────────────────────

import { v7 as uuidv7 } from "uuid";
import type { IGatewayCronClient } from "./core/gateway-cron.js";
import type { WrapperJobsRepo } from "./store/wrapper-jobs-repo.js";
import type { AuditRepo } from "./store/audit-repo.js";
import type { AgentCronConfig } from "./config.js";
import type { WrapperJob } from "./store/types.js";
import { nowMs } from "./util/time.js";
import {
  buildSchedule,
  buildPayload,
  buildDelivery,
  validateTimeout,
  validateDelivery,
  scheduleToInner,
  payloadToInner,
  deliveryToInner,
} from "./tools/helpers.js";

// ── Public types ─────────────────────────────────────────────────────

export interface AddJobParams {
  name: string;
  ownerAgentId: string;
  schedule: {
    kind: "at" | "every" | "cron";
    at?: string;
    intervalSeconds?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: "agentTurn";
    message: string;
    timeoutSeconds?: number;
  };
  delivery: {
    mode: "announce" | "none";
    channel: string;
    to: string;
  };
  enabled?: boolean;
}

export interface AddJobResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

// ── Module-level singletons (set by setDeps) ─────────────────────────

let _gateway: IGatewayCronClient | undefined;
let _wrapperRepo: WrapperJobsRepo | undefined;
let _auditRepo: AuditRepo | undefined;
let _config: AgentCronConfig | undefined;

/**
 * Inject dependencies after plugin initialisation.
 * Called once from the plugin's service start().
 */
// Cross-plugin symbol (same pattern as openclaw core's Symbol.for("openclaw.pluginRegistryState"))
const ADD_JOB_SYMBOL = Symbol.for("openclaw.agentCron.addJob");

export function setDeps(
  gateway: IGatewayCronClient,
  wrapperRepo: WrapperJobsRepo,
  auditRepo: AuditRepo,
  config: AgentCronConfig,
): void {
  _gateway = gateway;
  _wrapperRepo = wrapperRepo;
  _auditRepo = auditRepo;
  _config = config;

  // Expose addJob on globalThis so other plugins can access it without import
  (globalThis as Record<symbol, unknown>)[ADD_JOB_SYMBOL] = addJob;
}

/** Reset deps — only used by tests. */
export function _resetDeps(): void {
  _gateway = undefined;
  _wrapperRepo = undefined;
  _auditRepo = undefined;
  _config = undefined;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Programmatically create a cron job.
 *
 * Must be called **after** the agent-cron plugin service has started
 * (i.e. DB and gateway client are initialised).
 *
 * No ACL check — this is a trusted cross-plugin call.
 * An audit log entry is written with actorAgentId = ownerAgentId.
 */
export async function addJob(params: AddJobParams): Promise<AddJobResult> {
  try {
    // ── Lazy init guard ──────────────────────────────────────────
    if (!_gateway || !_wrapperRepo || !_auditRepo || !_config) {
      return {
        ok: false,
        error: "agent-cron plugin not initialized — call addJob only after plugin service has started",
      };
    }

    const gateway = _gateway;
    const wrapperRepo = _wrapperRepo;
    const auditRepo = _auditRepo;
    const config = _config;

    // ── Build typed objects (reuse helpers) ───────────────────────
    const schedule = buildSchedule(params.schedule as unknown as Record<string, unknown>);
    const payload = buildPayload(params.payload as unknown as Record<string, unknown>);
    validateTimeout(payload, config);
    const delivery = buildDelivery(params.delivery as unknown as Record<string, unknown>);
    validateDelivery(payload, delivery);

    // ── Interval minimum check ───────────────────────────────────
    if (schedule.kind === "every" && schedule.intervalSeconds < config.minIntervalSeconds) {
      return {
        ok: false,
        error: `Minimum interval is ${config.minIntervalSeconds}s, got ${schedule.intervalSeconds}s`,
      };
    }

    // ── Build inner cron params ──────────────────────────────────
    const innerSchedule = scheduleToInner(schedule, config.defaultTz);
    const innerPayload = payloadToInner(payload, delivery);

    const gatewayParams: Record<string, unknown> = {
      name: params.name,
      agentId: params.ownerAgentId,
      schedule: innerSchedule,
      payload: innerPayload,
      sessionTarget: "isolated",
      wakeMode: "now",
      enabled: params.enabled !== false,
    };

    gatewayParams.delivery = deliveryToInner(delivery);

    // ── Call gateway cron.add ────────────────────────────────────
    const innerJob = await gateway.add(gatewayParams);

    // ── Store wrapper mapping ────────────────────────────────────
    const now = nowMs();
    const wrapperId = uuidv7();
    const specJson = JSON.stringify({ schedule, payload, delivery });

    const wrapperJob: WrapperJob = {
      id: wrapperId,
      ownerAgentId: params.ownerAgentId,
      innerJobId: innerJob.id,
      name: params.name,
      specJson,
      createdAtMs: now,
      updatedAtMs: now,
      deletedAtMs: null,
    };

    wrapperRepo.insert(wrapperJob);

    // ── Audit log ────────────────────────────────────────────────
    if (config.audit.enabled) {
      auditRepo.log({
        actorAgentId: params.ownerAgentId,
        action: "create",
        jobId: wrapperId,
        targetOwnerAgentId: params.ownerAgentId,
        result: "ok",
      });
    }

    return { ok: true, jobId: wrapperId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
