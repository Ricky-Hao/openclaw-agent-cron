// ── Shared tool helpers (wrapper architecture) ──────────────────────

import type { WrapperJob, Schedule, InnerCronJob, InnerCronSchedule, Payload, Delivery } from "../store/types.js";
import type { AgentCronConfig } from "../config.js";
import { validationError } from "../util/errors.js";

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

/** Return a success JSON result */
export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
// ── Schedule format converters ─────────────────────────────────────

/**
 * Convert user-facing Schedule → inner cron schedule params.
 *
 * User-facing:
 *   { kind: "at",    at: string|number }
 *   { kind: "every", intervalSeconds: N, anchor?: ... }
 *   { kind: "cron",  expr: string, tz?: string }
 *
 * Inner cron:
 *   { kind: "at",    atMs: number }
 *   { kind: "every", everyMs: N*1000, anchorMs?: number }
 *   { kind: "cron",  expr: string, tz?: string }
 */
export function scheduleToInner(s: Schedule, defaultTz: string): Record<string, unknown> {
  switch (s.kind) {
    case "at": {
      const atMs = typeof s.at === "string" ? new Date(s.at).getTime() : s.at;
      if (!Number.isFinite(atMs) || atMs <= 0) {
        throw validationError(`Invalid 'at' value: ${String(s.at)}`);
      }
      return { kind: "at", atMs };
    }
    case "every": {
      const everyMs = s.intervalSeconds * 1000;
      const result: Record<string, unknown> = { kind: "every", everyMs };
      if (s.anchor !== undefined) {
        result.anchorMs = typeof s.anchor === "string" ? new Date(s.anchor).getTime() : s.anchor;
      }
      return result;
    }
    case "cron": {
      const result: Record<string, unknown> = { kind: "cron", expr: s.expr };
      result.tz = s.tz ?? defaultTz;
      return result;
    }
    default:
      throw validationError(`Unknown schedule kind: ${(s as { kind: string }).kind}`);
  }
}

/**
 * Convert inner cron schedule → user-facing Schedule for display.
 */
export function innerScheduleToUserFacing(inner: InnerCronSchedule): Schedule {
  switch (inner.kind) {
    case "at":
      return { kind: "at", at: inner.atMs ?? 0 };
    case "every":
      return {
        kind: "every",
        intervalSeconds: Math.round((inner.everyMs ?? 0) / 1000),
        anchor: inner.anchorMs,
      };
    case "cron":
      return { kind: "cron", expr: inner.expr ?? "", tz: inner.tz };
    default:
      return { kind: "cron", expr: "unknown", tz: undefined };
  }
}

// ── Payload format converters ──────────────────────────────────────

/**
 * Convert user-facing Payload → inner cron payload params.
 * Only agentTurn is supported.
 */
export function payloadToInner(p: Payload): Record<string, unknown> {
  return {
    kind: "agentTurn",
    message: p.message,
    ...(p.timeoutSeconds !== undefined ? { timeoutSeconds: p.timeoutSeconds } : {}),
  };
}

// ── Delivery format converters ─────────────────────────────────────

/**
 * Convert user-facing Delivery → inner cron delivery params.
 * Maps "none" (inner) ↔ "none" (user). Our old API used "silent" but
 * inner cron uses "none". We now use "none" in user-facing too.
 */
export function deliveryToInner(d: Delivery): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (d.mode !== undefined) result.mode = d.mode;
  if (d.channel !== undefined) result.channel = d.channel;
  if (d.to !== undefined) result.to = d.to;
  return result;
}

// ── WrapperJob serialization ───────────────────────────────────────

/**
 * Serialize a WrapperJob + inner cron state into a user-facing JSON object.
 */
export function wrapperJobToJson(
  wj: WrapperJob,
  inner?: InnerCronJob | null,
): Record<string, unknown> {
  const spec = safeParseJson(wj.specJson);
  const result: Record<string, unknown> = {
    id: wj.id,
    name: wj.name,
    ownerAgentId: wj.ownerAgentId,
    schedule: spec.schedule ?? null,
    payload: spec.payload ?? null,
    delivery: spec.delivery ?? null,
    createdAtMs: wj.createdAtMs,
    updatedAtMs: wj.updatedAtMs,
  };

  if (inner) {
    result.enabled = inner.enabled;
    result.state = {
      nextRunAtMs: inner.state?.nextRunAtMs ?? null,
      lastRunAtMs: inner.state?.lastRunAtMs ?? null,
      lastStatus: inner.state?.lastRunStatus ?? inner.state?.lastStatus ?? null,
      consecutiveErrors: inner.state?.consecutiveErrors ?? 0,
    };
  }

  return result;
}

// ── Build helpers for user input → typed objects ───────────────────

export function buildSchedule(raw: Record<string, unknown>): Schedule {
  const kind = raw.kind as string;
  switch (kind) {
    case "at":
      return { kind: "at", at: raw.at as string | number };
    case "every":
      return {
        kind: "every",
        intervalSeconds: raw.intervalSeconds as number,
        anchor: raw.anchor as string | number | undefined,
      };
    case "cron":
      return {
        kind: "cron",
        expr: raw.expr as string,
        tz: raw.tz as string | undefined,
      };
    default:
      throw validationError(`Unknown schedule kind: ${kind}`);
  }
}

export function buildPayload(raw: Record<string, unknown>): Payload {
  const kind = raw.kind as string;
  if (kind !== "agentTurn") {
    throw validationError(`Unknown payload kind: ${kind}`);
  }
  return {
    kind: "agentTurn",
    message: raw.message as string,
    timeoutSeconds: raw.timeoutSeconds as number | undefined,
  };
}

export function buildDelivery(raw: Record<string, unknown>): Delivery {
  return {
    mode: raw.mode as "announce" | "none" | undefined,
    channel: raw.channel as string | undefined,
    to: raw.to as string | undefined,
  };
}

/**
 * Validate timeoutSeconds for agentTurn payloads against config.maxTimeoutSeconds.
 * Only applies when payload.kind === "agentTurn" and timeoutSeconds is provided.
 */
export function validateTimeout(payload: Payload, config: AgentCronConfig): void {
  if (payload.kind !== "agentTurn" || payload.timeoutSeconds === undefined) return;
  if (payload.timeoutSeconds < 1 || payload.timeoutSeconds > config.maxTimeoutSeconds) {
    throw validationError(
      `timeoutSeconds must be between 1 and ${config.maxTimeoutSeconds}, got ${payload.timeoutSeconds}`,
    );
  }
}

/**
 * Validate delivery for agentTurn payloads.
 * For agentTurn: delivery is REQUIRED, mode must be "announce" or "none",
 * channel and to must be non-empty strings.
 */
export function validateDelivery(payload: Payload, delivery: Delivery | undefined): void {
  if (payload.kind !== "agentTurn") return;
  if (!delivery) {
    throw validationError(
      "delivery is required for agentTurn payloads (must include mode, channel, and to)",
    );
  }
  if (delivery.mode !== "announce" && delivery.mode !== "none") {
    throw validationError(
      `delivery.mode must be "announce" or "none" for agentTurn payloads, got "${delivery.mode ?? "undefined"}"`,
    );
  }
  if (!delivery.channel || delivery.channel.trim() === "") {
    throw validationError(
      "delivery.channel is required and must be a non-empty string for agentTurn payloads",
    );
  }
  if (!delivery.to || delivery.to.trim() === "") {
    throw validationError(
      "delivery.to is required and must be a non-empty string for agentTurn payloads",
    );
  }
}

// ── Internal helpers ───────────────────────────────────────────────

function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
