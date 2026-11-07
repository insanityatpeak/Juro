import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hearings (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  pause_reason TEXT,
  total_turns INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  next_action TEXT,
  chain_hash TEXT NOT NULL DEFAULT 'genesis',
  audit_root TEXT,
  verdict_json TEXT,
  human_decision TEXT,
  human_decided_at INTEGER,
  worker_id TEXT,
  heartbeat_at INTEGER,
  pause_requested INTEGER NOT NULL DEFAULT 0,
  control_token_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hearings_status ON hearings(status);

-- (hearing_id, seq) is the primary key, so a turn can never be stored twice.
CREATE TABLE IF NOT EXISTS turns (
  hearing_id TEXT NOT NULL REFERENCES hearings(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  addressed_to TEXT,
  evidence_refs TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hearing_id, seq)
);
`;

/** Open a database file (or ":memory:") and make sure the schema exists. */
export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS does not add them to old files. */
const ADDED_COLUMNS: [string, string][] = [
  ["pause_requested", "INTEGER NOT NULL DEFAULT 0"],
  ["control_token_hash", "TEXT"],
];

function migrate(db: Database.Database): void {
  const have = new Set((db.prepare("PRAGMA table_info(hearings)").all() as { name: string }[]).map((c) => c.name));
  for (const [name, def] of ADDED_COLUMNS) {
    if (!have.has(name)) db.exec(`ALTER TABLE hearings ADD COLUMN ${name} ${def}`);
  }
}

// One connection per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __juroHearingsDb?: Database.Database };

export function getDb(): Database.Database {
  if (!g.__juroHearingsDb) {
    const file = process.env.HEARINGS_DB_PATH || path.join(process.cwd(), ".data", "hearings.db");
    g.__juroHearingsDb = openDb(file);
  }
  return g.__juroHearingsDb;
}
