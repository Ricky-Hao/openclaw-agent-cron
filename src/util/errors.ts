// ── Error codes & structured error helpers ────────────────────────────

export type ErrorCode =
  | "ACL_DENY"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "QUOTA_EXCEEDED"
  | "INTERNAL_ERROR";

export class AgentCronError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentCronError";
  }
}

export function aclDeny(actor: string, action: string, target: string): AgentCronError {
  return new AgentCronError(
    "ACL_DENY",
    `Agent '${actor}' is not authorized to '${action}' on jobs owned by '${target}'`,
    { actor, action, target },
  );
}

export function notFound(entity: string, id: string): AgentCronError {
  return new AgentCronError("NOT_FOUND", `${entity} '${id}' not found`, { entity, id });
}

export function validationError(message: string, details?: Record<string, unknown>): AgentCronError {
  return new AgentCronError("VALIDATION_ERROR", message, details);
}

export function quotaExceeded(message: string, details?: Record<string, unknown>): AgentCronError {
  return new AgentCronError("QUOTA_EXCEEDED", message, details);
}

/** Format any error into a structured tool result */
export function errorResult(err: unknown): { content: Array<{ type: string; text: string }> } {
  if (err instanceof AgentCronError) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: err.code, message: err.message, details: err.details }),
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: JSON.stringify({ error: "INTERNAL_ERROR", message: msg }) }],
  };
}

export function internalError(message: string, details?: Record<string, unknown>): AgentCronError {
  return new AgentCronError("INTERNAL_ERROR", message, details);
}
