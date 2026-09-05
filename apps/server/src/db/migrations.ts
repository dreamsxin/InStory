import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  id: number;
  name: string;
  up: string;
}

/**
 * Ordered, append-only migration list. Never edit an applied migration in place:
 * add a new entry with the next id instead, otherwise existing databases drift
 * away from the schema this list describes.
 *
 * Migration 1 mirrors the schema that used to be created inline by each store
 * constructor, so it applies cleanly to databases created before the migration
 * runner existed.
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    up: `
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worlds (
        story_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id)
      );

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id)
      );

      CREATE TABLE IF NOT EXISTS story_anchors (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id)
      );

      CREATE TABLE IF NOT EXISTS reader_sessions (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reader_profiles (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reader_profiles_owner_id
      ON reader_profiles(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS model_config (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    id: 2,
    name: "session_and_story_lookup_indexes",
    up: `
      CREATE INDEX IF NOT EXISTS idx_reader_sessions_updated_at
      ON reader_sessions(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_reader_sessions_story_id
      ON reader_sessions(story_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_characters_story_id
      ON characters(story_id);

      CREATE INDEX IF NOT EXISTS idx_story_anchors_story_id
      ON story_anchors(story_id);
    `
  }
];

export function appliedMigrationIds(db: DatabaseSync): number[] {
  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

/**
 * Applies every pending migration inside a single transaction and returns the
 * ids that were applied. Safe to call on every boot.
 */
export function runMigrations(db: DatabaseSync, list: Migration[] = migrations): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(appliedMigrationIds(db));
  const pending = list.filter((migration) => !applied.has(migration.id));

  if (pending.length === 0) {
    return [];
  }

  db.exec("BEGIN");
  try {
    const now = new Date().toISOString();
    for (const migration of pending) {
      db.exec(migration.up);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        now
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return pending.map((migration) => migration.id);
}
