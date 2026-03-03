// ── agent_cron_remove ────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { AuditRepo } from "../store/audit-repo.js";
import { canAccess, isAdmin } from "../acl.js";
import { errorResult, aclDeny, notFound } from "../util/errors.js";
import { jsonResult, type ToolResult } from "./helpers.js";

export const removeParameters: TSchema = Type.Object({
  jobId: Type.String({ description: "Job ID to remove" }),
  hard: Type.Optional(Type.Boolean({
    description: "If true, permanently delete the job (admin only). Default is soft-delete.",
  })),
});

export function createRemoveExecute(
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
      const { jobId, hard } = params as { jobId: string; hard?: boolean };

      const wj = wrapperRepo.getById(jobId);
      if (!wj) throw notFound("Job", jobId);

      const acl = canAccess(callerAgentId, "remove", wj.ownerAgentId, config);
      if (!acl.allowed) throw aclDeny(callerAgentId, "remove", wj.ownerAgentId);

      // Hard delete requires admin privileges
      if (hard && !isAdmin(callerAgentId, config)) {
        throw aclDeny(callerAgentId, "hard-delete", wj.ownerAgentId);
      }

      // ── Call gateway cron.remove ──────────────────────────────────
      await gateway.remove({ jobId: wj.innerJobId });

      // ── Update wrapper record ────────────────────────────────────
      if (hard) {
        wrapperRepo.hardDelete(jobId);
      } else {
        wrapperRepo.softDelete(jobId);
      }

      const mode = hard ? "hard" : "soft";

      if (config.audit.enabled) {
        auditRepo.log({
          actorAgentId: callerAgentId,
          action: "delete",
          jobId: wj.id,
          targetOwnerAgentId: wj.ownerAgentId,
          result: "ok",
          detail: { mode },
        });
      }

      return jsonResult({ ok: true, deleted: jobId, mode });
    } catch (err) {
      return errorResult(err);
    }
  };
}
