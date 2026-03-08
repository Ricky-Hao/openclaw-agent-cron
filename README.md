# openclaw-agent-cron

ACL wrapper around OpenClaw's built-in cron. Provides `agent_cron_*` tools with per-agent isolation, quota enforcement, and audit logging. The plugin does **not** schedule jobs itself — it delegates to the built-in `cron.*` tools via the gateway CLI and enforces access control at the plugin layer.

## Features

- **9 tools**: `agent_cron_add`, `agent_cron_list`, `agent_cron_get`, `agent_cron_update`, `agent_cron_remove`, `agent_cron_pause`, `agent_cron_resume`, `agent_cron_run`, `agent_cron_runs`
- **Cross-plugin API**: Exposes `addJob()` via `globalThis[Symbol.for("openclaw.agentCron.addJob")]` for other plugins to schedule jobs programmatically (no import needed)
- **Per-agent isolation**: Non-admin agents can only manage their own jobs
- **Admin cross-agent access**: Configured admin agents can manage all jobs
- **3 schedule types**: `at` (one-shot), `every` (interval), `cron` (5-field with timezone)
- **Gateway delegation**: All scheduling is handled by OpenClaw's built-in cron engine
- **SQLite wrapper store**: Maps wrapper job IDs to inner cron IDs for ACL enforcement
- **Audit logging**: All operations logged with actor, action, and result
- **Quota enforcement**: Per-agent job limits and minimum interval checks

## Installation

```bash
cd /path/to/openclaw-agent-cron
npm install
npm run build
```

## Configuration

Add to your `openclaw.json` plugin entries:

```json
{
  "plugins": {
    "entries": {
      "agent-cron": {
        "source": "/path/to/openclaw-agent-cron",
        "config": {
          "storePath": "/path/to/data/agent-cron",
          "defaultTz": "Asia/Shanghai",
          "adminAgentIds": ["main"],
          "maxJobsPerAgent": 100,
          "minIntervalSeconds": 60,
          "maxTimeoutSeconds": 600,
          "gateway": {
            "openclawBin": "openclaw",
            "timeoutMs": 15000
          },
          "audit": {
            "enabled": true,
            "retentionDays": 90
          }
        }
      }
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storePath` | string | `<stateDir>/agent-cron` | Directory for SQLite database files |
| `defaultTz` | string | `"UTC"` | Default IANA timezone for cron expressions |
| `adminAgentIds` | string[] | `["main"]` | Agent IDs with cross-agent access |
| `maxJobsPerAgent` | number | `100` | Max active jobs per agent |
| `minIntervalSeconds` | number | `60` | Minimum allowed interval for `every` schedules |
| `maxTimeoutSeconds` | number | `600` | Maximum allowed timeout for payloads |
| `gateway.openclawBin` | string | `"openclaw"` | Path to the `openclaw` binary (resolved via PATH) |
| `gateway.timeoutMs` | number | `15000` | Gateway call timeout in milliseconds |
| `audit.enabled` | boolean | `true` | Enable audit logging |
| `audit.retentionDays` | number | `90` | Audit log retention in days |

## How It Works

```
Agent ──► agent_cron_add ──► ACL check ──► gateway call ──► cron.add (built-in)
                              │                                  │
                              ▼                                  ▼
                         wrapper_jobs (SQLite)            Inner cron engine
                         maps wrapper ID → inner ID       schedules & executes
```

1. An agent calls an `agent_cron_*` tool (e.g., `agent_cron_add`).
2. The plugin checks **ACL** — non-admin agents can only operate on their own jobs.
3. The plugin checks **quota** — per-agent job limits and minimum interval.
4. The plugin delegates to OpenClaw's built-in cron via `openclaw gateway call cron.*`.
5. A local SQLite `wrapper_jobs` table maps the wrapper job ID (exposed to agents) to the inner cron job ID (managed by the built-in engine).

## Tools Reference

### agent_cron_add

Create a new scheduled job.

```json
{
  "name": "morning-report",
  "schedule": { "kind": "every", "intervalSeconds": 3600 },
  "payload": { "kind": "agentTurn", "message": "Generate the morning report" },
  "delivery": { "mode": "announce", "channel": "#general", "to": "@team" },
  "enabled": true
}
```

**Schedule kinds:**
- `at`: One-shot at a specific time — `{ "kind": "at", "at": "2025-12-31T00:00:00Z" }`
- `every`: Repeating interval — `{ "kind": "every", "intervalSeconds": 300 }`
- `cron`: Cron expression — `{ "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" }`

**Payload kinds:**
- `agentTurn`: `{ "kind": "agentTurn", "message": "Do something" }`

**Delivery (required for `agentTurn`):**

All `agentTurn` jobs **must** include a `delivery` object with:
- `mode`: Must be `"announce"`
- `channel`: Non-empty string (target channel)
- `to`: Non-empty string (target recipient)

```json
"delivery": { "mode": "announce", "channel": "#reports", "to": "@team" }
```

Missing or invalid delivery returns `VALIDATION_ERROR`.
### agent_cron_list

List jobs. Non-admin sees only own jobs; admin can filter by `ownerAgentId`.

### agent_cron_get

Get a job by `jobId` (wrapper job ID).

### agent_cron_update

Partially update a job by `jobId`. Can update name, schedule, payload, and delivery.

### agent_cron_remove

Soft-delete a job by `jobId`. Admin can pass `hard: true` to permanently remove.

### agent_cron_pause / agent_cron_resume

Pause or resume a job.

### agent_cron_run

Manually trigger an immediate execution of a job.

### agent_cron_runs

Query execution history for a job by `jobId`.

## Cross-Plugin API

Other OpenClaw plugins can schedule jobs programmatically without importing this package. After the plugin starts, `addJob` is available on `globalThis`:

```typescript
const ADD_JOB = Symbol.for("openclaw.agentCron.addJob");

type AddJobFn = (params: {
  name: string;
  ownerAgentId: string;
  schedule: { kind: "at"; at: string };
  payload: { kind: "agentTurn"; message: string; timeoutSeconds?: number };
  delivery: { mode: "announce"; channel: string; to: string };
}) => Promise<{ ok: boolean; jobId?: string; error?: string }>;

const addJob = (globalThis as Record<symbol, unknown>)[ADD_JOB] as AddJobFn | undefined;
if (typeof addJob === "function") {
  const result = await addJob({
    name: "my-task",
    ownerAgentId: "my-agent",
    schedule: { kind: "at", at: new Date(Date.now() + 600_000).toISOString() },
    payload: { kind: "agentTurn", message: "Do something in 10 minutes" },
    delivery: { mode: "announce", channel: "qq", to: "qq:group:111222333" },
  });
  console.log(result); // { ok: true, jobId: "..." }
}
```

This follows the same `Symbol.for` + `globalThis` pattern used by OpenClaw core for cross-module state sharing, avoiding module-instance duplication issues with `import()`.

## Permission Model

| Actor | Action | Allowed? |
|-------|--------|----------|
| Admin agent | Any action on any job | Yes |
| Non-admin agent | Any action on own job | Yes |
| Non-admin agent | Any action on another agent's job | Denied (ACL_DENY) |

Admin agents are configured via `adminAgentIds` (default: `["main"]`).

**Session isolation:** All jobs default to `sessionTarget: "isolated"` to prevent cross-agent interference.

## Running Tests

```bash
# All tests (212 tests)
npm test
```

Tests use an in-memory SQLite database and a mock gateway client (`MockGatewayCronClient`) — no real gateway process is needed.

## Build

```bash
npm run build        # one-time build
npm run dev          # watch mode
```

## Architecture

```
src/
├── index.ts                Plugin entry: tool + service registration
├── api.ts                  Programmatic API (addJob) + globalThis symbol exposure
├── config.ts               Config interface & defaults merging
├── acl.ts                  Per-agent ACL (admin bypass / owner check)
├── core/
│   └── gateway-cron.ts     IGatewayCronClient interface + gateway spawn impl
├── store/
│   ├── types.ts            WrapperJob, InnerCronJob, AuditEntry, Schedule, etc.
│   ├── schema.sql          SQLite DDL (wrapper_jobs + audit tables)
│   ├── db.ts               Database initialization (WAL mode)
│   ├── wrapper-jobs-repo.ts  Wrapper job mapping (insert, lookup, soft/hard delete)
│   └── audit-repo.ts       Audit logging + purge
├── tools/
│   ├── helpers.ts          Schedule/payload/delivery converters, result formatters
│   ├── add.ts              agent_cron_add
│   ├── list.ts             agent_cron_list
│   ├── get.ts              agent_cron_get
│   ├── update.ts           agent_cron_update
│   ├── remove.ts           agent_cron_remove
│   ├── pause.ts            agent_cron_pause
│   ├── resume.ts           agent_cron_resume
│   ├── run.ts              agent_cron_run
│   └── runs.ts             agent_cron_runs
└── util/
    ├── errors.ts           Error codes & structured error helpers
    ├── time.ts             Time utilities
    └── redact.ts           Audit log sanitization

tests/
├── helpers/
│   ├── mock-gateway.ts     MockGatewayCronClient (in-memory, no spawn)
│   └── test-config.ts      Shared test config & parseResult helper
├── unit/
│   ├── acl.test.ts         ACL allow/deny logic
│   ├── redact.test.ts      Audit log redaction
│   └── schema.test.ts      WrapperJobsRepo + AuditRepo operations
└── integration/
    ├── crud.test.ts         Full tool CRUD flow with mock gateway
    ├── acl-cross-agent.test.ts  Cross-agent ACL denial + admin override
    └── hard-delete-audit.test.ts  Hard-delete, soft-delete, audit snapshots
```

## Known Limitations

1. **Only `agentTurn` payload is supported**: `systemEvent` is intentionally unsupported in this plugin version.
2. **SQLite-only storage**: No alternative storage backends (e.g., PostgreSQL).
3. **No web dashboard**: All management is via agent tool calls only.
4. **Gateway binary required**: The `openclaw` CLI must be available on the system PATH (or configured via `gateway.openclawBin`).
