import type { StorySession } from "@instory/shared";
import type { AppDatabase } from "./app-database.js";

export interface SessionListItem {
  id: string;
  storyId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

export class SessionStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
    this.database.db.exec(`
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
    this.database.db
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
    const row = this.database.db.prepare("SELECT payload FROM reader_sessions WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.payload) as StorySession;
  }

  count(): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM reader_sessions").get() as { count: number };
    return row.count;
  }

  listRecent(limit = 20): SessionListItem[] {
    const rows = this.database.db
      .prepare(
        `
        SELECT id, story_id AS storyId, payload, created_at AS createdAt, updated_at AS updatedAt
        FROM reader_sessions
        ORDER BY updated_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      id: string;
      storyId: string;
      payload: string;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map((row) => {
      const session = JSON.parse(row.payload) as StorySession;
      return {
        id: row.id,
        storyId: row.storyId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        turnCount: session.turns.length
      };
    });
  }

  get databasePath(): string {
    return this.database.databasePath;
  }
}
