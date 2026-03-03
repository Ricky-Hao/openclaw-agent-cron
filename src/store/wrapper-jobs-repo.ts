// ── Wrapper Jobs Repository ──────────────────────────────────────────
//
// Local SQLite mapping: wrapper_job_id ↔ inner_cron_id + owner ACL.
// ─────────────────────────────────────────────────────────────────────

import type Database from "better-sqlite3";
import type { WrapperJob } from "./types.js";
import { nowMs } from "../util/time.js";

interface WrapperJobRow {
  id: string;
  owner_agent_id: string;
  inner_job_id: string;
  name: string;
  spec_json: string;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
}

function rowToWrapperJob(r: WrapperJobRow): WrapperJob {
  return {
    id: r.id,
    ownerAgentId: r.owner_agent_id,
    innerJobId: r.inner_job_id,
    name: r.name,
    specJson: r.spec_json,
    createdAtMs: r.created_at_ms,
    updatedAtMs: r.updated_at_ms,
    deletedAtMs: r.deleted_at_ms,
  };
}

export class WrapperJobsRepo {
  private stmtInsert;
  private stmtGetById;
  private stmtGetByInnerId;
  private stmtListByOwner;
  private stmtListAll;
  private stmtUpdateName;
  private stmtUpdateSpec;
  private stmtSoftDelete;
  private stmtHardDelete;
  private stmtCountByOwner;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO wrapper_jobs (id, owner_agent_id, inner_job_id, name, spec_json, created_at_ms, updated_at_ms)
      VALUES (@id, @owner_agent_id, @inner_job_id, @name, @spec_json, @created_at_ms, @updated_at_ms)
    `);

    this.stmtGetById = db.prepare(
      "SELECT * FROM wrapper_jobs WHERE id = ? AND deleted_at_ms IS NULL",
    );

    this.stmtGetByInnerId = db.prepare(
      "SELECT * FROM wrapper_jobs WHERE inner_job_id = ? AND deleted_at_ms IS NULL",
    );

    this.stmtListByOwner = db.prepare(
      "SELECT * FROM wrapper_jobs WHERE owner_agent_id = ? AND deleted_at_ms IS NULL ORDER BY created_at_ms DESC LIMIT ? OFFSET ?",
    );

    this.stmtListAll = db.prepare(
      "SELECT * FROM wrapper_jobs WHERE deleted_at_ms IS NULL ORDER BY created_at_ms DESC LIMIT ? OFFSET ?",
    );

    this.stmtUpdateName = db.prepare(
      "UPDATE wrapper_jobs SET name = ?, updated_at_ms = ? WHERE id = ? AND deleted_at_ms IS NULL",
    );

    this.stmtUpdateSpec = db.prepare(
      "UPDATE wrapper_jobs SET spec_json = ?, updated_at_ms = ? WHERE id = ? AND deleted_at_ms IS NULL",
    );

    this.stmtSoftDelete = db.prepare(
      "UPDATE wrapper_jobs SET deleted_at_ms = ?, updated_at_ms = ? WHERE id = ? AND deleted_at_ms IS NULL",
    );

    this.stmtHardDelete = db.prepare(
      "DELETE FROM wrapper_jobs WHERE id = ?",
    );

    this.stmtCountByOwner = db.prepare(
      "SELECT COUNT(*) as cnt FROM wrapper_jobs WHERE owner_agent_id = ? AND deleted_at_ms IS NULL",
    );
  }

  insert(job: WrapperJob): void {
    this.stmtInsert.run({
      id: job.id,
      owner_agent_id: job.ownerAgentId,
      inner_job_id: job.innerJobId,
      name: job.name,
      spec_json: job.specJson,
      created_at_ms: job.createdAtMs,
      updated_at_ms: job.updatedAtMs,
    });
  }

  getById(id: string): WrapperJob | undefined {
    const row = this.stmtGetById.get(id) as WrapperJobRow | undefined;
    return row ? rowToWrapperJob(row) : undefined;
  }

  getByInnerId(innerJobId: string): WrapperJob | undefined {
    const row = this.stmtGetByInnerId.get(innerJobId) as WrapperJobRow | undefined;
    return row ? rowToWrapperJob(row) : undefined;
  }

  listByOwner(ownerAgentId: string, limit = 50, offset = 0): WrapperJob[] {
    return (this.stmtListByOwner.all(ownerAgentId, limit, offset) as WrapperJobRow[]).map(rowToWrapperJob);
  }

  listAll(limit = 50, offset = 0): WrapperJob[] {
    return (this.stmtListAll.all(limit, offset) as WrapperJobRow[]).map(rowToWrapperJob);
  }

  updateName(id: string, name: string): boolean {
    const result = this.stmtUpdateName.run(name, nowMs(), id);
    return result.changes > 0;
  }

  updateSpec(id: string, specJson: string): boolean {
    const result = this.stmtUpdateSpec.run(specJson, nowMs(), id);
    return result.changes > 0;
  }

  softDelete(id: string): boolean {
    const now = nowMs();
    const result = this.stmtSoftDelete.run(now, now, id);
    return result.changes > 0;
  }

  hardDelete(id: string): boolean {
    const result = this.stmtHardDelete.run(id);
    return result.changes > 0;
  }

  countByOwner(ownerAgentId: string): number {
    return (this.stmtCountByOwner.get(ownerAgentId) as { cnt: number }).cnt;
  }
}
