// ── Plugin configuration (wrapper architecture) ─────────────────────

export interface AuditConfig {
  enabled: boolean;
  retentionDays: number;
}

export interface GatewayConfig {
  /** Path to openclaw binary. Default: "openclaw" (resolved via PATH). */
  openclawBin: string;
  /** Gateway call timeout in milliseconds. Default: 15000. */
  timeoutMs: number;
}

export interface AgentCronConfig {
  storePath: string;
  defaultTz: string;
  adminAgentIds: string[];
  maxJobsPerAgent: number;
  minIntervalSeconds: number;
  maxTimeoutSeconds: number;
  gateway: GatewayConfig;
  audit: AuditConfig;
}

const DEFAULTS: AgentCronConfig = {
  storePath: "",
  defaultTz: "UTC",
  adminAgentIds: ["main"],
  maxJobsPerAgent: 100,
  minIntervalSeconds: 60,
  maxTimeoutSeconds: 600,
  gateway: { openclawBin: "openclaw", timeoutMs: 15_000 },
  audit: { enabled: true, retentionDays: 90 },
};

/** Merge user-supplied config with defaults */
export function resolveConfig(
  raw: Record<string, unknown> | undefined,
  fallbackStorePath: string,
): AgentCronConfig {
  const r = raw ?? {};
  const auditRaw = (r.audit ?? {}) as Record<string, unknown>;
  const gatewayRaw = (r.gateway ?? {}) as Record<string, unknown>;
  return {
    storePath: typeof r.storePath === "string" && r.storePath ? r.storePath : fallbackStorePath,
    defaultTz: typeof r.defaultTz === "string" ? r.defaultTz : DEFAULTS.defaultTz,
    adminAgentIds: Array.isArray(r.adminAgentIds) ? r.adminAgentIds.map(String) : DEFAULTS.adminAgentIds,
    maxJobsPerAgent: asPositiveInt(r.maxJobsPerAgent, DEFAULTS.maxJobsPerAgent),
    minIntervalSeconds: asPositiveInt(r.minIntervalSeconds, DEFAULTS.minIntervalSeconds),
    maxTimeoutSeconds: asPositiveInt(r.maxTimeoutSeconds, DEFAULTS.maxTimeoutSeconds),
    gateway: {
      openclawBin:
        typeof gatewayRaw.openclawBin === "string" && gatewayRaw.openclawBin
          ? gatewayRaw.openclawBin
          : DEFAULTS.gateway.openclawBin,
      timeoutMs: asPositiveInt(gatewayRaw.timeoutMs, DEFAULTS.gateway.timeoutMs),
    },
    audit: {
      enabled: typeof auditRaw.enabled === "boolean" ? auditRaw.enabled : DEFAULTS.audit.enabled,
      retentionDays: asPositiveInt(auditRaw.retentionDays, DEFAULTS.audit.retentionDays),
    },
  };
}

function asPositiveInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) return Math.trunc(v);
  return fallback;
}
