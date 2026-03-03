-- agent-cron SQLite schema v2 (wrapper architecture)

CREATE TABLE IF NOT EXISTS wrapper_jobs (
  id TEXT PRIMARY KEY,
  owner_agent_id TEXT NOT NULL,
  inner_job_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  spec_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wj_owner ON wrapper_jobs(owner_agent_id) WHERE deleted_at_ms IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wj_inner ON wrapper_jobs(inner_job_id) WHERE deleted_at_ms IS NULL;

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,
  actor_agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  job_id TEXT,
  target_owner_agent_id TEXT,
  result TEXT NOT NULL DEFAULT 'ok',
  detail_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts_ms DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor_agent_id, ts_ms DESC);
