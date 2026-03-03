// ── Audit repository ────────────────────────────────────────────────

import type Database from "better-sqlite3";
import type { AuditAction, AuditEntry } from "./types.js";
import { nowMs } from "../util/time.js";
import { redactSensitive } from "../util/redact.js";

interface AuditRow {
  id: number;
  ts_ms: number;
  actor_agent_id: string;
  action: string;
  job_id: string | null;
  target_owner_agent_id: string | null;
  result: string;
  detail_json: string | null;
}

function rowToEntry(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    tsMs: r.ts_ms,
    actorAgentId: r.actor_agent_id,
    action: r.action as AuditAction,
    jobId: r.job_id,
    targetOwnerAgentId: r.target_owner_agent_id,
    result: r.result as "ok" | "denied" | "error",
    detailJson: r.detail_json,
  };
}

export class AuditRepo {
  private stmtInsert;
  private stmtListByAgent;
  private stmtPurge;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO audit (ts_ms, actor_agent_id, action, job_id, target_owner_agent_id, result, detail_json)
      VALUES (@ts_ms, @actor_agent_id, @action, @job_id, @target_owner_agent_id, @result, @detail_json)
    `);

    this.stmtListByAgent = db.prepare(
      "SELECT * FROM audit WHERE actor_agent_id = ? ORDER BY ts_ms DESC LIMIT ?",
    );

    this.stmtPurge = db.prepare(
      "DELETE FROM audit WHERE ts_ms < ?",
    );
  }

  log(entry: {
    actorAgentId: string;
    action: AuditAction;
    jobId?: string | null;
    targetOwnerAgentId?: string | null;
    result: "ok" | "denied" | "error";
    detail?: unknown;
  }): void {
    this.stmtInsert.run({
      ts_ms: nowMs(),
      actor_agent_id: entry.actorAgentId,
      action: entry.action,
      job_id: entry.jobId ?? null,
      target_owner_agent_id: entry.targetOwnerAgentId ?? null,
      result: entry.result,
      detail_json: entry.detail ? JSON.stringify(redactSensitive(entry.detail)) : null,
    });
  }

  listByAgent(agentId: string, limit = 100): AuditEntry[] {
    return (this.stmtListByAgent.all(agentId, limit) as AuditRow[]).map(rowToEntry);
  }

  /** Purge entries older than retentionMs */
  purge(retentionMs: number): number {
    const cutoff = nowMs() - retentionMs;
    const result = this.stmtPurge.run(cutoff);
    return result.changes;
  }
}
