// ── SQLite database initialization ──────────────────────────────────

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedSchema: string | undefined;
function readSchema(): string {
  if (!cachedSchema) {
    cachedSchema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  }
  return cachedSchema;
}

export function openDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Production pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -8000"); // 8 MB

  // Run schema (idempotent due to IF NOT EXISTS)
  db.exec(readSchema());

  return db;
}

/** Open an in-memory database (for tests) */
export function openMemoryDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // For in-memory, read schema from source directly
  const schemaPath = join(__dirname, "schema.sql");
  let schema: string;
  try {
    schema = readFileSync(schemaPath, "utf-8");
  } catch {
    // Fallback: read from src when running via tsx
    const srcSchemaPath = join(__dirname, "..", "..", "src", "store", "schema.sql");
    schema = readFileSync(srcSchemaPath, "utf-8");
  }
  db.exec(schema);

  return db;
}
