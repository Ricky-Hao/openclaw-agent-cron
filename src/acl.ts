// ── ACL – Access Control Layer ───────────────────────────────────────

import type { AgentCronConfig } from "./config.js";

export type AclAction =
  | "add"
  | "list"
  | "get"
  | "update"
  | "remove"
  | "pause"
  | "resume"
  | "run"
  | "runs";

export interface AclDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Core ACL check.
 * - Admin agents can access any target.
 * - Non-admin agents can only access their own resources (ownerAgentId === actorAgentId).
 */
export function canAccess(
  actorAgentId: string,
  action: AclAction,
  targetOwnerAgentId: string,
  config: AgentCronConfig,
): AclDecision {
  // Admin bypass
  if (config.adminAgentIds.includes(actorAgentId)) {
    return { allowed: true, reason: "admin" };
  }
  // Self-access
  if (actorAgentId === targetOwnerAgentId) {
    return { allowed: true, reason: "owner" };
  }
  // Default deny
  return {
    allowed: false,
    reason: `agent '${actorAgentId}' cannot '${action}' jobs owned by '${targetOwnerAgentId}'`,
  };
}

/** Check if an agent is an admin */
export function isAdmin(agentId: string, config: AgentCronConfig): boolean {
  return config.adminAgentIds.includes(agentId);
}
