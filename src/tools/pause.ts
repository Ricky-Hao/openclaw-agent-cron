// ── agent_cron_pause ─────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { AuditRepo } from "../store/audit-repo.js";
import { canAccess } from "../acl.js";
import { errorResult, aclDeny, notFound } from "../util/errors.js";
import { jsonResult, type ToolResult } from "./helpers.js";

export const pauseParameters: TSchema = Type.Object({
  jobId: Type.String({ description: "Job ID to pause" }),
});

export function createPauseExecute(
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
      const { jobId } = params as { jobId: string };

      const wj = wrapperRepo.getById(jobId);
      if (!wj) throw notFound("Job", jobId);

      const acl = canAccess(callerAgentId, "pause", wj.ownerAgentId, config);
      if (!acl.allowed) throw aclDeny(callerAgentId, "pause", wj.ownerAgentId);

      // ── Call gateway cron.update to disable ──────────────────────
      await gateway.update({ jobId: wj.innerJobId, patch: { enabled: false } });

      if (config.audit.enabled) {
        auditRepo.log({
          actorAgentId: callerAgentId,
          action: "pause",
          jobId: wj.id,
          targetOwnerAgentId: wj.ownerAgentId,
          result: "ok",
        });
      }

      return jsonResult({ ok: true, paused: jobId });
    } catch (err) {
      return errorResult(err);
    }
  };
}
