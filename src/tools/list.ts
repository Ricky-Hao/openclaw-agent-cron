// ── agent_cron_list ──────────────────────────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import type { InnerCronJob } from "../store/types.js";
import { isAdmin } from "../acl.js";
import { errorResult } from "../util/errors.js";
import { jsonResult, wrapperJobToJson, type ToolResult } from "./helpers.js";

export const listParameters: TSchema = Type.Object({
  ownerAgentId: Type.Optional(Type.String({ description: "Filter by owner agent ID (admin only for cross-agent)" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50, description: "Max results" })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0, description: "Pagination offset" })),
});

export function createListExecute(
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
      const p = params as { ownerAgentId?: string; limit?: number; offset?: number };
      const limit = Math.min(p.limit ?? 50, 200);
      const offset = p.offset ?? 0;

      let wrapperJobs;
      if (isAdmin(callerAgentId, config)) {
        // Admin can list all or filter by owner
        if (p.ownerAgentId) {
          wrapperJobs = wrapperRepo.listByOwner(p.ownerAgentId, limit, offset);
        } else {
          wrapperJobs = wrapperRepo.listAll(limit, offset);
        }
      } else {
        // Non-admin can only see own jobs
        wrapperJobs = wrapperRepo.listByOwner(callerAgentId, limit, offset);
      }

      // Fetch inner cron state for enrichment (best-effort)
      let innerJobsMap: Map<string, InnerCronJob> = new Map();
      try {
        const innerList = await gateway.list({ limit: 200 });
        for (const ij of innerList.jobs) {
          innerJobsMap.set(ij.id, ij);
        }
      } catch {
        // If gateway fails, we still return wrapper data without inner state
      }

      const jobs = wrapperJobs.map((wj) => {
        const inner = innerJobsMap.get(wj.innerJobId) ?? null;
        return wrapperJobToJson(wj, inner);
      });

      return jsonResult({
        ok: true,
        jobs,
        count: jobs.length,
        limit,
        offset,
      });
    } catch (err) {
      return errorResult(err);
    }
  };
}
