// ── agent_cron_run (manual trigger) ──────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { AuditRepo } from "../store/audit-repo.js";
import { canAccess } from "../acl.js";
import { errorResult, aclDeny, notFound } from "../util/errors.js";
import { jsonResult, type ToolResult } from "./helpers.js";

export const runParameters: TSchema = Type.Object({
  jobId: Type.String({ description: "Job ID to trigger immediately" }),
});

export function createRunExecute(
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

      const acl = canAccess(callerAgentId, "run", wj.ownerAgentId, config);
      if (!acl.allowed) throw aclDeny(callerAgentId, "run", wj.ownerAgentId);

      // ── Call gateway cron.run ─────────────────────────────────────
      const result = await gateway.run({ id: wj.innerJobId });

      if (config.audit.enabled) {
        auditRepo.log({
          actorAgentId: callerAgentId,
          action: "run",
          jobId: wj.id,
          targetOwnerAgentId: wj.ownerAgentId,
          result: "ok",
        });
      }

      return jsonResult({
        ok: true,
        message: "Job triggered",
        jobId,
        gatewayResult: result,
      });
    } catch (err) {
      return errorResult(err);
    }
  };
}
