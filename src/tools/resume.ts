// ── agent_cron_resume ────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { AuditRepo } from "../store/audit-repo.js";
import { canAccess } from "../acl.js";
import { errorResult, aclDeny, notFound } from "../util/errors.js";
import { jsonResult, type ToolResult } from "./helpers.js";

export const resumeParameters: TSchema = Type.Object({
  jobId: Type.String({ description: "Job ID to resume" }),
});

export function createResumeExecute(
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

      const acl = canAccess(callerAgentId, "resume", wj.ownerAgentId, config);
      if (!acl.allowed) throw aclDeny(callerAgentId, "resume", wj.ownerAgentId);

      // ── Call gateway cron.update to enable ─────────────────────
      const innerJob = await gateway.update({ jobId: wj.innerJobId, patch: { enabled: true } });

      if (config.audit.enabled) {
        auditRepo.log({
          actorAgentId: callerAgentId,
          action: "resume",
          jobId: wj.id,
          targetOwnerAgentId: wj.ownerAgentId,
          result: "ok",
        });
      }

      return jsonResult({
        ok: true,
        resumed: jobId,
        nextRunAtMs: innerJob.state?.nextRunAtMs ?? null,
      });
    } catch (err) {
      return errorResult(err);
    }
  };
}
