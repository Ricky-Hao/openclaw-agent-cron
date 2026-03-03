// ── OpenClaw agent-cron plugin entry point (wrapper architecture) ────
//
// Registers 9 agent_cron_* tools that wrap OpenClaw's built-in cron
// via gateway calls, with per-agent ACL enforced at the plugin layer.
//
// No self-contained scheduler — all scheduling delegated to inner cron.
// ─────────────────────────────────────────────────────────────────────

import { join } from "node:path";
import { resolveConfig, type AgentCronConfig } from "./config.js";
import { openDatabase } from "./store/db.js";
import { WrapperJobsRepo } from "./store/wrapper-jobs-repo.js";
import { AuditRepo } from "./store/audit-repo.js";
import { GatewayCronClient } from "./core/gateway-cron.js";

// Tool schemas & factories
import { addParameters, createAddExecute } from "./tools/add.js";
import { listParameters, createListExecute } from "./tools/list.js";
import { getParameters, createGetExecute } from "./tools/get.js";
import { updateParameters, createUpdateExecute } from "./tools/update.js";
import { removeParameters, createRemoveExecute } from "./tools/remove.js";
import { pauseParameters, createPauseExecute } from "./tools/pause.js";
import { resumeParameters, createResumeExecute } from "./tools/resume.js";
import { runParameters, createRunExecute } from "./tools/run.js";
import { runsParameters, createRunsExecute } from "./tools/runs.js";

import type { ToolResult } from "./tools/helpers.js";
import { setDeps } from "./api.js";

// ── Types for OpenClaw Plugin SDK ────────────────────────────────────
// Minimal interfaces matching the actual SDK types (from
// openclaw/dist/plugin-sdk/plugins/types.d.ts).  Keeps us free from a
// hard compile-time dependency on the openclaw package.

export interface PluginLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
}

export interface PluginToolContext {
  config?: Record<string, unknown>;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
}

interface PluginTool {
  name: string;
  description?: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
}

type ToolFactory = (ctx: PluginToolContext) => PluginTool | PluginTool[] | null;

export interface PluginServiceContext {
  config?: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
}

interface PluginService {
  id: string;
  start: (ctx: PluginServiceContext) => void | Promise<void>;
  stop?: (ctx: PluginServiceContext) => void | Promise<void>;
}

export interface OpenClawPluginApi {
  /** Plugin id (same as manifest id) */
  id: string;
  /** Plugin name */
  name: string;
  /** Plugin version */
  version?: string;
  /** Plugin description */
  description?: string;
  /** Source path of the plugin */
  source: string;
  /** Global OpenClaw config */
  config: Record<string, unknown>;
  /** Plugin-specific config (from openclaw.json) */
  pluginConfig?: Record<string, unknown>;
  /** Runtime information */
  runtime?: Record<string, unknown>;
  /** Logger */
  logger: PluginLogger;
  /** Register a tool or tool factory */
  registerTool: (tool: PluginTool | ToolFactory, opts?: { optional?: boolean }) => void;
  /** Register a background service */
  registerService: (service: PluginService) => void;
  /** Register a lifecycle hook */
  registerHook?: (hookName: string, handler: (...args: unknown[]) => void) => void;
  /** Register a CLI command */
  registerCommand?: (...args: unknown[]) => void;
  /** Resolve a path relative to plugin source */
  resolvePath: (input: string) => string;
  /** Subscribe to a named hook event */
  on?: (hookName: string, handler: (...args: unknown[]) => void) => void;
}

// ── Singleton state (per process) ────────────────────────────────────

let config: AgentCronConfig;
let wrapperRepo: WrapperJobsRepo;
let auditRepo: AuditRepo;
let gateway: GatewayCronClient;
let initialized = false;

function ensureInit(api: OpenClawPluginApi, stateDir?: string): void {
  if (initialized) return;

  const fallbackStore = join(stateDir ?? ".", "agent-cron");
  config = resolveConfig(api.pluginConfig, fallbackStore);

  const dbPath = join(config.storePath, "agent-cron.db");
  const db = openDatabase(dbPath);

  wrapperRepo = new WrapperJobsRepo(db);
  auditRepo = new AuditRepo(db);
  gateway = new GatewayCronClient({
    openclawBin: config.gateway.openclawBin,
    timeoutMs: config.gateway.timeoutMs,
  });

  // Expose singletons to the programmatic API
  setDeps(gateway, wrapperRepo, auditRepo, config);

  initialized = true;
  api.logger.info(`[agent-cron] initialized — db=${dbPath}`);
}

// ── Helper: wrap a 3-arg execute into a ToolFactory ──────────────────

function makeToolFactory(
  name: string,
  description: string,
  parameters: unknown,
  executeFn: (id: string, params: Record<string, unknown>, callerAgentId: string) => Promise<ToolResult>,
): ToolFactory {
  return (ctx: PluginToolContext) => {
    const callerAgentId = ctx.agentId ?? "unknown";
    return {
      name,
      description,
      parameters,
      async execute(id: string, params: Record<string, unknown>): Promise<ToolResult> {
        return executeFn(id, params, callerAgentId);
      },
    };
  };
}

// ── Plugin definition (OpenClawPluginDefinition format) ─────────────
//
// Matches the object export pattern expected by OpenClaw's plugin loader.
// See: openclaw-qq/src/index.ts for reference.

function register(api: OpenClawPluginApi): void {

  // ── Register 9 tools via ToolFactory ─────────────────────────────

  const toolDefs: Array<{
    name: string;
    description: string;
    parameters: unknown;
    createExecute: () => (id: string, params: Record<string, unknown>, callerAgentId: string) => Promise<ToolResult>;
  }> = [
    {
      name: "agent_cron_add",
      description: "Create a new scheduled job for this agent. Supports one-shot (at), interval (every), and cron schedules.",
      parameters: addParameters,
      createExecute: () => createAddExecute(gateway, wrapperRepo, auditRepo, config),
    },
    {
      name: "agent_cron_list",
      description: "List scheduled jobs. Non-admin agents see only their own jobs.",
      parameters: listParameters,
      createExecute: () => createListExecute(gateway, wrapperRepo, config),
    },
    {
      name: "agent_cron_get",
      description: "Get details of a specific scheduled job by ID.",
      parameters: getParameters,
      createExecute: () => createGetExecute(gateway, wrapperRepo, config),
    },
    {
      name: "agent_cron_update",
      description: "Update an existing scheduled job (schedule, payload, delivery, etc.).",
      parameters: updateParameters,
      createExecute: () => createUpdateExecute(gateway, wrapperRepo, auditRepo, config),
    },
    {
      name: "agent_cron_remove",
      description: "Remove a scheduled job. Soft-delete by default; pass hard=true for permanent deletion (admin only).",
      parameters: removeParameters,
      createExecute: () => createRemoveExecute(gateway, wrapperRepo, auditRepo, config),
    },
    {
      name: "agent_cron_pause",
      description: "Pause a scheduled job (disable it from firing).",
      parameters: pauseParameters,
      createExecute: () => createPauseExecute(gateway, wrapperRepo, auditRepo, config),
    },
    {
      name: "agent_cron_resume",
      description: "Resume a paused scheduled job.",
      parameters: resumeParameters,
      createExecute: () => createResumeExecute(gateway, wrapperRepo, auditRepo, config),
    },
    {
      name: "agent_cron_run",
      description: "Manually trigger an immediate execution of a scheduled job.",
      parameters: runParameters,
      createExecute: () => createRunExecute(gateway, wrapperRepo, auditRepo, config),
    },
    {
      name: "agent_cron_runs",
      description: "Query execution history (runs) for a job or agent.",
      parameters: runsParameters,
      createExecute: () => createRunsExecute(gateway, wrapperRepo, config),
    },
  ];

  for (const def of toolDefs) {
    const factory = makeToolFactory(
      def.name,
      def.description,
      def.parameters,
      // Lazy: create execute function on first invocation
      (id, params, callerAgentId) => {
        if (!initialized) {
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ error: "INTERNAL_ERROR", message: "Plugin not initialized — service has not been started yet" }) }],
          });
        }
        const fn = def.createExecute();
        return fn(id, params, callerAgentId);
      },
    );
    api.registerTool(factory as unknown as PluginTool);
  }

  // ── Register init service (replaces old scheduler service) ───────
  // The service only initializes the DB / gateway client; no scheduler
  // runs in-process since built-in cron handles scheduling.

  api.registerService({
    id: "agent-cron-init",
    start(ctx: PluginServiceContext) {
      ensureInit(api, ctx.stateDir);
    },
  });
}

const plugin = {
  id: "agent-cron",
  name: "Agent Cron",
  description:
    "Agent-isolated cron scheduling. Wraps OpenClaw built-in cron with per-agent ACL, quotas, and audit logging.",
  version: "0.2.0",
  register,
};

export default plugin;
export { register };
export { addJob, type AddJobParams, type AddJobResult } from "./api.js";
