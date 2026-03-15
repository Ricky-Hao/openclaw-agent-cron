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
export function payloadToInner(p: Payload, delivery?: Delivery): Record<string, unknown> {
  let message = p.message;

  if (delivery?.mode === "none" && delivery.channel && delivery.to) {
    // "none" mode: agent sends messages itself via tools
    message =
      `[Cron Task Protocol - mode: none]\n` +
      `\n` +
      `你正在执行一个定时任务，请严格按以下流程操作：\n` +
      `\n` +
      `## Step 1: 执行任务\n` +
      `${p.message}\n` +
      `\n` +
      `## Step 2: 发送结果\n` +
      `根据任务执行结果，判断是否需要通知用户：\n` +
      `- 如果需要通知，使用 message 工具发送到 channel="${delivery.channel}", to="${delivery.to}"\n` +
      `  - 文本内容：直接用 message 参数\n` +
      `  - 图片/文件：用 media 或 filePath 参数\n` +
      `  - 如果任务本身已通过工具发送了消息（如 poll_create），则不需要再发\n` +
      `- 如果不需要通知（无变更、无异常、纯后台操作），跳过此步\n` +
      `\n` +
      `## Step 3: 结束\n` +
      `输出 NO_REPLY`;
  } else if (delivery?.mode === "announce") {
    // "announce" mode: system auto-sends your final reply to the channel
    message =
      `[Cron Task Protocol - mode: announce]\n` +
      `\n` +
      `你正在执行一个定时任务。你的最终回复会被系统自动发送到 channel="${delivery.channel ?? ""}", to="${delivery.to ?? ""}"。\n` +
      `\n` +
      `## 规则\n` +
      `- 不要自己调用 message 工具发送消息，系统会自动发送你的回复\n` +
      `- 你的回复内容就是最终发送给用户的内容，请直接输出最终文本\n` +
      `- 如果不需要通知用户（如无变更、无异常），回复 NO_REPLY（系统会跳过发送）\n` +
      `- 不要输出多余的解释或状态说明，只输出要发送的内容或 NO_REPLY\n` +
      `\n` +
      `## 任务\n` +
      `${p.message}`;
  }

  return {
    kind: "agentTurn",
    message,
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
