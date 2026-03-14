// ── Gateway Cron Client ──────────────────────────────────────────────
//
// Spawn-based wrapper around `openclaw gateway call cron.*` commands.
// No shell concatenation — uses spawn(file, args) exclusively.
// ─────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import type {
  InnerCronJob,
  InnerCronListResult,
  InnerCronRunsResult,
} from "../store/types.js";
import { internalError } from "../util/errors.js";

export interface GatewayCronClientOptions {
  openclawBin?: string;
  timeoutMs?: number;
}

/**
 * Interface for gateway cron operations.
 * Implementations: `GatewayCronClient` (real) and mock for tests.
 */
export interface IGatewayCronClient {
  add(params: Record<string, unknown>): Promise<InnerCronJob>;
  list(params?: Record<string, unknown>): Promise<InnerCronListResult>;
  update(params: Record<string, unknown>): Promise<InnerCronJob>;
  remove(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  run(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  runs(params?: Record<string, unknown>): Promise<InnerCronRunsResult>;
}

/**
 * Real gateway cron client using `openclaw gateway call`.
 */
export class GatewayCronClient implements IGatewayCronClient {
  private readonly bin: string;
  private readonly timeoutMs: number;

  constructor(opts?: GatewayCronClientOptions) {
    this.bin = opts?.openclawBin ?? "openclaw";
    this.timeoutMs = opts?.timeoutMs ?? 15_000;
  }

  async add(params: Record<string, unknown>): Promise<InnerCronJob> {
    return this.call<InnerCronJob>("cron.add", params);
  }

  async list(params?: Record<string, unknown>): Promise<InnerCronListResult> {
    return this.call<InnerCronListResult>("cron.list", params);
  }

  async update(params: Record<string, unknown>): Promise<InnerCronJob> {
    return this.call<InnerCronJob>("cron.update", params);
  }

  async remove(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("cron.remove", params);
  }

  async run(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("cron.run", params);
  }

  async runs(params?: Record<string, unknown>): Promise<InnerCronRunsResult> {
    return this.call<InnerCronRunsResult>("cron.runs", params);
  }

  /**
   * Generic gateway call: spawns `openclaw gateway call <method> --json --params '<json>'`.
   * Returns parsed JSON stdout. Throws AgentCronError on failure.
   */
  private call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const args = ["gateway", "call", method, "--json"];
      if (params && Object.keys(params).length > 0) {
        args.push("--params", JSON.stringify(params));
      }
      args.push("--timeout", String(this.timeoutMs));

      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(this.bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        timeout: this.timeoutMs + 5000, // OS-level kill slightly after our timeout
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Application-level timeout
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        reject(
          internalError(`Gateway call '${method}' timed out after ${this.timeoutMs}ms`, {
            method,
            timeoutMs: this.timeoutMs,
          }),
        );
      }, this.timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed) return; // already rejected

        if (code !== 0) {
          const msg = stderr.trim() || `exit code ${code}`;
          reject(
            internalError(`Gateway call '${method}' failed: ${msg}`, {
              method,
              exitCode: code,
              stderr: stderr.slice(0, 500),
            }),
          );
          return;
        }

        // Parse JSON stdout — strip non-JSON prefix lines (e.g. plugin logs)
        try {
          let json = stdout;
          const jsonStart = json.indexOf("{");
          if (jsonStart > 0) {
            json = json.slice(jsonStart);
          }
          const parsed = JSON.parse(json) as T;
          resolve(parsed);
        } catch {
          reject(
            internalError(`Gateway call '${method}' returned invalid JSON`, {
              method,
              stdout: stdout.slice(0, 500),
            }),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (killed) return;
        reject(
          internalError(`Gateway call '${method}' spawn error: ${err.message}`, {
            method,
            spawnError: err.message,
          }),
        );
      });
    });
  }
}
