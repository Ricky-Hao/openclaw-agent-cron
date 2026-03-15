// ── agent_cron_update ────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { AuditRepo } from "../store/audit-repo.js";
import type { Payload, Delivery } from "../store/types.js";
import { canAccess } from "../acl.js";
import { errorResult, aclDeny, notFound, validationError } from "../util/errors.js";
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

export const updateParameters: TSchema = Type.Object({
  jobId: Type.String({ description: "Job ID to update" }),
  name: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.Object({
    kind: Type.Union([Type.Literal("at"), Type.Literal("every"), Type.Literal("cron")]),
    at: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    intervalSeconds: Type.Optional(Type.Number({ minimum: 1 })),
    anchor: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    expr: Type.Optional(Type.String()),
    tz: Type.Optional(Type.String()),
  })),
  payload: Type.Optional(Type.Object({
    kind: Type.Literal("agentTurn"),
    message: Type.Optional(Type.String()),
    timeoutSeconds: Type.Optional(Type.Number()),
  })),
  delivery: Type.Optional(Type.Object({
    mode: Type.Union([Type.Literal("announce"), Type.Literal("none")], { description: "Delivery mode: 'announce' to send agent reply to channel, 'none' if agent sends messages itself in the session" }),
    channel: Type.String({ description: "Target channel (required for agentTurn)" }),
    to: Type.String({ description: "Target recipient (required for agentTurn)" }),
  }, { description: "Delivery config (required when payload is agentTurn)" })),
});

export function createUpdateExecute(
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
        jobId: string;
        name?: string;
        schedule?: Record<string, unknown>;
        payload?: Record<string, unknown>;
        delivery?: Record<string, unknown>;
      };

      const wj = wrapperRepo.getById(p.jobId);
      if (!wj) throw notFound("Job", p.jobId);

      const acl = canAccess(callerAgentId, "update", wj.ownerAgentId, config);
      if (!acl.allowed) throw aclDeny(callerAgentId, "update", wj.ownerAgentId);

      // Capture before-snapshot for audit
      const beforeSpec = wj.specJson;

      // ── Build gateway update params ──────────────────────────────
      const patch: Record<string, unknown> = {};

      // Parse existing spec for merging
      let currentSpec: Record<string, unknown>;
      try {
        currentSpec = JSON.parse(wj.specJson) as Record<string, unknown>;
      } catch {
        currentSpec = {};
      }

      if (p.name !== undefined) {
        patch.name = p.name;
      }

      if (p.schedule) {
        const schedule = buildSchedule(p.schedule);

        // Interval minimum check
        if (schedule.kind === "every" && schedule.intervalSeconds < config.minIntervalSeconds) {
          throw validationError(
            `Minimum interval is ${config.minIntervalSeconds}s, got ${schedule.intervalSeconds}s`,
          );
        }

        patch.schedule = scheduleToInner(schedule, config.defaultTz);
        currentSpec.schedule = schedule;
      }

      if (p.payload) {
        const payload = buildPayload(p.payload);
        validateTimeout(payload, config);
        patch.payload = payloadToInner(payload);
        currentSpec.payload = payload;
      }

      if (p.delivery !== undefined) {
        const delivery = buildDelivery(p.delivery);
        patch.delivery = deliveryToInner(delivery);
        currentSpec.delivery = delivery;
      }

      // Validate delivery when payload is agentTurn (existing or newly set)
      const effectivePayload = p.payload ? buildPayload(p.payload) : (currentSpec.payload as Payload | undefined);
      const effectiveDelivery = p.delivery ? buildDelivery(p.delivery) : (currentSpec.delivery as Delivery | undefined);
      if (effectivePayload) {
        validateDelivery(effectivePayload, effectiveDelivery);
      }

      // ── Call gateway cron.update ──────────────────────────────────
      const innerJob = await gateway.update({ jobId: wj.innerJobId, patch });

      // ── Update wrapper record ────────────────────────────────────
      const newSpecJson = JSON.stringify(currentSpec);
      if (newSpecJson !== wj.specJson) {
        wrapperRepo.updateSpec(wj.id, newSpecJson);
      }
      if (p.name !== undefined) {
        wrapperRepo.updateName(wj.id, p.name);
      }

      // Re-read wrapper for consistent response
      const updatedWj = wrapperRepo.getById(wj.id) ?? wj;

      if (config.audit.enabled) {
        auditRepo.log({
          actorAgentId: callerAgentId,
          action: "update",
          jobId: wj.id,
          targetOwnerAgentId: wj.ownerAgentId,
          result: "ok",
          detail: { before: beforeSpec, after: newSpecJson },
        });
      }

      return jsonResult({ ok: true, job: wrapperJobToJson(updatedWj, innerJob) });
    } catch (err) {
      return errorResult(err);
    }
  };
}
