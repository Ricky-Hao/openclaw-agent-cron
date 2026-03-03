// ── Audit log redaction ──────────────────────────────────────────────

const SENSITIVE_KEYS = new Set(["token", "password", "secret", "apikey", "api_key", "authorization"]);

/** Shallow-redact sensitive keys from an object for audit logging */
export function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "***REDACTED***";
    } else if (typeof v === "object" && v !== null) {
      out[k] = redactSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
