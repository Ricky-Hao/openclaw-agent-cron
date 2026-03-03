// ── Data types (wrapper architecture) ────────────────────────────────

// ── Schedule (user-facing) ──────────────────────────────────────────

export type ScheduleKind = "at" | "every" | "cron";

export interface ScheduleAt {
  kind: "at";
  /** ISO-8601 datetime or epoch ms */
  at: string | number;
}

export interface ScheduleEvery {
  kind: "every";
  /** Interval in seconds (user-facing; converted to everyMs for inner cron) */
  intervalSeconds: number;
  /** Optional anchor time (ISO-8601 or epoch ms). */
  anchor?: string | number;
}

export interface ScheduleCron {
  kind: "cron";
  /** Standard 5-field cron expression */
  expr: string;
  /** IANA timezone. Falls back to plugin defaultTz. */
  tz?: string;
}

export type Schedule = ScheduleAt | ScheduleEvery | ScheduleCron;

// ── Payload ─────────────────────────────────────────────────────────

export interface PayloadAgentTurn {
  kind: "agentTurn";
  message: string;
  timeoutSeconds?: number;
}

export type Payload = PayloadAgentTurn;

// ── Delivery ────────────────────────────────────────────────────────

export interface Delivery {
  mode?: "announce" | "none";
  channel?: string;
  to?: string;
}

// ── WrapperJob (local SQLite record) ────────────────────────────────

export interface WrapperJob {
  /** Wrapper-layer UUID (user-facing, never the inner cron id) */
  id: string;
  /** Owner agent ID (for ACL) */
  ownerAgentId: string;
  /** Inner cron job ID (from openclaw gateway cron.add) */
  innerJobId: string;
  /** Human-readable name */
  name: string;
  /** User-facing schedule spec (stored for display/audit) */
  specJson: string;
  /** Created timestamp ms */
  createdAtMs: number;
  /** Updated timestamp ms */
  updatedAtMs: number;
  /** Soft-delete timestamp ms (null = active) */
  deletedAtMs: number | null;
}

// ── Inner cron types (returned by gateway calls) ────────────────────

export interface InnerCronSchedule {
  kind: "every" | "cron" | "at";
  everyMs?: number;
  anchorMs?: number;
  expr?: string;
  tz?: string;
  staggerMs?: number;
  atMs?: number;
}

export interface InnerCronPayload {
  kind: "agentTurn" | "systemEvent";
  message?: string;
  timeoutSeconds?: number;
  event?: string;
}

export interface InnerCronDelivery {
  mode: "announce" | "none";
  channel?: string;
  to?: string;
}

export interface InnerCronState {
  nextRunAtMs: number;
  lastRunAtMs?: number;
  lastStatus?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastRunStatus?: string;
  lastDelivered?: boolean;
  lastDeliveryStatus?: string;
}

export interface InnerCronJob {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: InnerCronSchedule;
  sessionTarget: string;
  wakeMode?: string;
  payload: InnerCronPayload;
  delivery?: InnerCronDelivery;
  state: InnerCronState;
}

export interface InnerCronListResult {
  jobs: InnerCronJob[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface InnerCronRunEntry {
  runId?: string;
  jobId: string;
  startedAtMs: number;
  finishedAtMs?: number;
  status: string;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

export interface InnerCronRunsResult {
  entries: InnerCronRunEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}
// ── Audit ───────────────────────────────────────────────────────────

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "pause"
  | "resume"
  | "run"
  | "acl-deny";

export interface AuditEntry {
  id: number;
  tsMs: number;
  actorAgentId: string;
  action: AuditAction;
  jobId: string | null;
  targetOwnerAgentId: string | null;
  result: "ok" | "denied" | "error";
  detailJson: string | null;
}
