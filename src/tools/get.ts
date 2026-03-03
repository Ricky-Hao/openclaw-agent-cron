// ── agent_cron_get ───────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { InnerCronJob } from "../store/types.js";
import { canAccess } from "../acl.js";
import { errorResult, aclDeny, notFound } from "../util/errors.js";
import { jsonResult, wrapperJobToJson, type ToolResult } from "./helpers.js";

export const getParameters: TSchema = Type.Object({
  jobId: Type.String({ description: "Job ID to retrieve" }),
});

export function createGetExecute(
  gateway: IGatewayCronClient,
  wrapperRepo: WrapperJobsRepo,
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

      const acl = canAccess(callerAgentId, "get", wj.ownerAgentId, config);
      if (!acl.allowed) throw aclDeny(callerAgentId, "get", wj.ownerAgentId);

      // Fetch inner cron state (best-effort)
      let inner: InnerCronJob | null = null;
      let innerStateAvailable = false;
      try {
        const allJobs = await gateway.list({ limit: 200 });
        inner = allJobs.jobs.find((j) => j.id === wj.innerJobId) ?? null;
        innerStateAvailable = true;
      } catch {
        // Inner state unavailable; we still return wrapper data
      }

      return jsonResult({ ok: true, innerStateAvailable, job: wrapperJobToJson(wj, inner) });
    } catch (err) {
      return errorResult(err);
    }
  };
}
