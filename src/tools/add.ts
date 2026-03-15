// ── agent_cron_add ───────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import { v7 as uuidv7 } from "uuid";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { AuditRepo } from "../store/audit-repo.js";
import type { WrapperJob } from "../store/types.js";
import { canAccess } from "../acl.js";
import { nowMs } from "../util/time.js";
import { errorResult, aclDeny, validationError, quotaExceeded } from "../util/errors.js";
import {
  jsonResult,
  wrapperJobToJson,
  buildSchedule,
  buildPayload,
  buildDelivery,
  validateTimeout,
  validateDelivery,
  scheduleToInner,
  payloadToInner,
  deliveryToInner,
  type ToolResult,
} from "./helpers.js";

export const addParameters: TSchema = Type.Object({
  name: Type.String({ description: "Human-readable job name" }),
  schedule: Type.Object({
    kind: Type.Union([Type.Literal("at"), Type.Literal("every"), Type.Literal("cron")], {
      description: "Schedule type: at (one-shot), every (interval), cron (cron expression)",
    }),
    at: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: "ISO-8601 datetime or epoch ms (for kind=at)" })),
    intervalSeconds: Type.Optional(Type.Number({ description: "Interval in seconds (for kind=every)", minimum: 1 })),
    anchor: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: "Anchor time for interval (for kind=every)" })),
    expr: Type.Optional(Type.String({ description: "5-field cron expression (for kind=cron)" })),
    tz: Type.Optional(Type.String({ description: "IANA timezone (for kind=cron)" })),
  }),
  payload: Type.Object({
    kind: Type.Literal("agentTurn", {
      description: "Payload type (only agentTurn is supported)",
    }),
    message: Type.String({ description: "Message for agentTurn" }),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout for agentTurn" })),
  }),
  delivery: Type.Object({
    mode: Type.Union([Type.Literal("announce"), Type.Literal("none")], { description: "Delivery mode: 'announce' to send agent reply to channel, 'none' if agent sends messages itself in the session" }),
    channel: Type.String({ description: "Target channel (required for agentTurn)" }),
    to: Type.String({ description: "Target recipient (required for agentTurn)" }),
  }, { description: "Delivery config (required for agentTurn payloads)" }),
  enabled: Type.Optional(Type.Boolean({ description: "Start enabled (default: true)" })),
});

export function createAddExecute(
  gateway: IGatewayCronClient,
  wrapperRepo: WrapperJobsRepo,
  auditRepo: AuditRepo,
  config: AgentCronConfig,
) {
  return async function execute(
    _id: string,
    params: Record<string, unknown>,
    callerAgentId: string,
  ): Promise<ToolResult> {
    try {
      const p = params as {
        name: string;
        schedule: Record<string, unknown>;
        payload: Record<string, unknown>;
        delivery?: Record<string, unknown>;
        enabled?: boolean;
      };

      // ── ACL: caller creates jobs owned by themselves ─────────────
      const acl = canAccess(callerAgentId, "add", callerAgentId, config);
      if (!acl.allowed) {
        if (config.audit.enabled) {
          auditRepo.log({ actorAgentId: callerAgentId, action: "create", result: "denied" });
        }
        throw aclDeny(callerAgentId, "add", callerAgentId);
      }

      // ── Quota check ──────────────────────────────────────────────
      const currentCount = wrapperRepo.countByOwner(callerAgentId);
      if (currentCount >= config.maxJobsPerAgent) {
        throw quotaExceeded(
          `Agent '${callerAgentId}' has ${currentCount}/${config.maxJobsPerAgent} jobs`,
          { currentCount, max: config.maxJobsPerAgent },
        );
      }

      // ── Build typed objects ──────────────────────────────────────
      const schedule = buildSchedule(p.schedule);
      const payload = buildPayload(p.payload);
      validateTimeout(payload, config);
      const delivery = p.delivery ? buildDelivery(p.delivery) : undefined;
      validateDelivery(payload, delivery);

      // ── Interval minimum check ───────────────────────────────────
      if (schedule.kind === "every" && schedule.intervalSeconds < config.minIntervalSeconds) {
        throw validationError(
          `Minimum interval is ${config.minIntervalSeconds}s, got ${schedule.intervalSeconds}s`,
        );
      }

      // ── Build inner cron params ──────────────────────────────────
      const innerSchedule = scheduleToInner(schedule, config.defaultTz);
      const innerPayload = payloadToInner(payload, delivery);

      const gatewayParams: Record<string, unknown> = {
        name: p.name,
        agentId: callerAgentId,
        schedule: innerSchedule,
        payload: innerPayload,
        sessionTarget: "isolated",
        wakeMode: "now",
        enabled: p.enabled !== false,
      };

      if (delivery) {
        gatewayParams.delivery = deliveryToInner(delivery);
      }

      // ── Call gateway cron.add ────────────────────────────────────
      const innerJob = await gateway.add(gatewayParams);

      // ── Store wrapper mapping ────────────────────────────────────
      const now = nowMs();
      const wrapperId = uuidv7();
      const specJson = JSON.stringify({ schedule, payload, delivery: delivery ?? null });

      const wrapperJob: WrapperJob = {
        id: wrapperId,
        ownerAgentId: callerAgentId,
        innerJobId: innerJob.id,
        name: p.name,
        specJson,
        createdAtMs: now,
        updatedAtMs: now,
        deletedAtMs: null,
      };

      wrapperRepo.insert(wrapperJob);

      if (config.audit.enabled) {
        auditRepo.log({
          actorAgentId: callerAgentId,
          action: "create",
          jobId: wrapperId,
          targetOwnerAgentId: callerAgentId,
          result: "ok",
        });
      }

      return jsonResult({ ok: true, job: wrapperJobToJson(wrapperJob, innerJob) });
    } catch (err) {
      return errorResult(err);
    }
  };
}
