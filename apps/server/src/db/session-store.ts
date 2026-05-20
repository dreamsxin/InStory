import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StorySession } from "@instory/shared";

export class SessionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });

    this.db = new DatabaseSync(resolvedPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reader_sessions (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  save(session: StorySession): void {
    this.db
      .prepare(
        `
        INSERT INTO reader_sessions (id, story_id, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          story_id = excluded.story_id,
          payload = excluded.payload,
          updated_at = excluded.updated_at;
      `
      )
      .run(session.id, session.storyId, JSON.stringify(session), session.createdAt, session.updatedAt);
  }

  findById(id: string): StorySession | null {
    const row = this.db.prepare("SELECT payload FROM reader_sessions WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.payload) as StorySession;
  }

  close(): void {
    this.db.close();
  }
}
