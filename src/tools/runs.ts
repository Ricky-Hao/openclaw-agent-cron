// ── agent_cron_runs (query run history) ──────────────────────────────

import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentCronConfig } from "../config.js";
import type { IGatewayCronClient } from "../core/gateway-cron.js";
import type { WrapperJobsRepo } from "../store/wrapper-jobs-repo.js";
import { canAccess, isAdmin } from "../acl.js";
import { errorResult, aclDeny, notFound } from "../util/errors.js";
import { jsonResult, type ToolResult } from "./helpers.js";

export const runsParameters: TSchema = Type.Object({
  jobId: Type.Optional(Type.String({ description: "Filter runs by job ID" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50, description: "Max results" })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0, description: "Pagination offset" })),
});

export function createRunsExecute(
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
      const p = params as { jobId?: string; limit?: number; offset?: number };
      const limit = Math.min(p.limit ?? 50, 200);
      const offset = p.offset ?? 0;

      // ── Filter by specific jobId ──────────────────────────────────
      if (p.jobId) {
        const wj = wrapperRepo.getById(p.jobId);
        if (!wj) throw notFound("Job", p.jobId);

        const acl = canAccess(callerAgentId, "runs", wj.ownerAgentId, config);
        if (!acl.allowed) throw aclDeny(callerAgentId, "runs", wj.ownerAgentId);

        const runsResult = await gateway.runs({
          jobId: wj.innerJobId,
          limit,
          offset,
        });

        return jsonResult({
          ok: true,
          runs: runsResult.entries,
          total: runsResult.total,
          count: runsResult.entries.length,
          limit,
          offset,
        });
      }

      // ── No jobId: list runs for own jobs (or all for admin) ──────
      if (isAdmin(callerAgentId, config)) {
        // Admin can see all runs
        const runsResult = await gateway.runs({ limit, offset });
        return jsonResult({
          ok: true,
          runs: runsResult.entries,
          total: runsResult.total,
          count: runsResult.entries.length,
          limit,
          offset,
        });
      }

      // Non-admin: fetch runs for all owned wrapper jobs
      const ownJobs = wrapperRepo.listByOwner(callerAgentId, 200, 0);
      const innerJobIds = ownJobs.map((wj) => wj.innerJobId);

      if (innerJobIds.length === 0) {
        return jsonResult({ ok: true, runs: [], total: 0, count: 0, limit, offset });
      }

      // Fetch runs from gateway and filter to owned inner job IDs
      const runsResult = await gateway.runs({ limit: 200, offset: 0 });
      const ownedRuns = runsResult.entries.filter((r) => innerJobIds.includes(r.jobId));
      const paginatedRuns = ownedRuns.slice(offset, offset + limit);

      return jsonResult({
        ok: true,
        runs: paginatedRuns,
        total: ownedRuns.length,
        count: paginatedRuns.length,
        limit,
        offset,
      });
    } catch (err) {
      return errorResult(err);
    }
  };
}
