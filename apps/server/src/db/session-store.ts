import type { ReaderRole, SessionTurn, StorySession, TimelineNode, WorldState } from "@instory/shared";
import type { AppDatabase } from "./app-database.js";

export interface SessionListItem {
  id: string;
  storyId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

/** Everything `/api/me/sessions` needs, read without loading the full history. */
export interface SessionOverview extends SessionListItem {
  readerRoleName: string;
  latestNarration: string | null;
}

export interface AppendTurnInput {
  turn: SessionTurn;
  state: WorldState;
  timelineNode?: TimelineNode | null;
  updatedAt: string;
}

/**
 * Sessions are stored relationally: the session row holds the reader role, the
 * current world state and a denormalised turn counter, while turns and timeline
 * nodes live in their own tables. Appending a turn therefore inserts one row
 * instead of rewriting the entire history, and listing sessions never parses a
 * full transcript.
 */
export class SessionStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  /** Inserts a session together with its initial turns and timeline nodes. */
  create(session: StorySession, userId: string): void {
    this.database.db.exec("BEGIN");
    try {
      this.database.db
        .prepare(
          `INSERT INTO reader_sessions (id, story_id, user_id, reader_role, state, turn_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             story_id = excluded.story_id,
             user_id = excluded.user_id,
             reader_role = excluded.reader_role,
             state = excluded.state,
             turn_count = excluded.turn_count,
             updated_at = excluded.updated_at`
        )
        .run(
          session.id,
          session.storyId,
          userId,
          JSON.stringify(session.readerRole),
          JSON.stringify(session.state),
          session.turns.length,
          session.createdAt,
          session.updatedAt
        );

      session.turns.forEach((turn, index) => this.insertTurn(session.id, turn, index));
      session.timeline.forEach((node, index) => this.insertTimelineNode(session.id, node, index));

      this.database.db.exec("COMMIT");
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Appends a single turn and its optional timeline node without rewriting history. */
  appendTurn(sessionId: string, input: AppendTurnInput): void {
    this.database.db.exec("BEGIN");
    try {
      const turnSeq = this.nextSeq("session_turns", sessionId);
      this.insertTurn(sessionId, input.turn, turnSeq);

      if (input.timelineNode) {
        this.insertTimelineNode(sessionId, input.timelineNode, this.nextSeq("session_timeline_nodes", sessionId));
      }

      this.database.db
        .prepare("UPDATE reader_sessions SET state = ?, turn_count = turn_count + 1, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(input.state), input.updatedAt, sessionId);

      this.database.db.exec("COMMIT");
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Reads a session. Pass ownerId to require the session to belong to that user;
   * omitting it is only appropriate for admin-facing reads.
   */
  findById(id: string, ownerId?: string): StorySession | null {
    const row = this.database.db
      .prepare(
        `SELECT id, story_id AS storyId, user_id AS userId, reader_role AS readerRole, state,
                created_at AS createdAt, updated_at AS updatedAt
         FROM reader_sessions WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          storyId: string;
          userId: string;
          readerRole: string | null;
          state: string | null;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    if (ownerId !== undefined && row.userId !== ownerId) {
      return null;
    }

    return {
      id: row.id,
      storyId: row.storyId,
      readerRole: JSON.parse(row.readerRole ?? "{}") as ReaderRole,
      state: JSON.parse(row.state ?? "{}") as WorldState,
      turns: this.listTurns(id),
      timeline: this.listTimeline(id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  count(): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM reader_sessions").get() as { count: number };
    return row.count;
  }

  listRecent(limit = 20): SessionListItem[] {
    return this.database.db
      .prepare(
        `SELECT id, story_id AS storyId, created_at AS createdAt, updated_at AS updatedAt,
                turn_count AS turnCount
         FROM reader_sessions
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit) as unknown as SessionListItem[];
  }

  /**
   * Returns the caller's most recent session per story with just the fields the
   * "continue reading" list needs, so it never has to load and parse a transcript.
   */
  listRecentOverviews(ownerId: string, limit = 20): SessionOverview[] {
    const rows = this.database.db
      .prepare(
        `SELECT s.id, s.story_id AS storyId, s.created_at AS createdAt, s.updated_at AS updatedAt,
                s.turn_count AS turnCount, s.reader_role AS readerRole,
                (SELECT t.narration FROM session_turns t
                  WHERE t.session_id = s.id ORDER BY t.seq DESC LIMIT 1) AS latestNarration
         FROM reader_sessions s
         WHERE s.user_id = ?
           AND s.updated_at = (
             SELECT MAX(inner_s.updated_at) FROM reader_sessions inner_s
             WHERE inner_s.story_id = s.story_id AND inner_s.user_id = s.user_id
           )
         ORDER BY s.updated_at DESC
         LIMIT ?`
      )
      .all(ownerId, limit) as Array<{
      id: string;
      storyId: string;
      createdAt: string;
      updatedAt: string;
      turnCount: number;
      readerRole: string | null;
      latestNarration: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      storyId: row.storyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      turnCount: row.turnCount,
      readerRoleName: (JSON.parse(row.readerRole ?? "{}") as Partial<ReaderRole>).name ?? "读者",
      latestNarration: row.latestNarration
    }));
  }

  get databasePath(): string {
    return this.database.databasePath;
  }

  private nextSeq(table: "session_turns" | "session_timeline_nodes", sessionId: string): number {
    const row = this.database.db
      .prepare(`SELECT COALESCE(MAX(seq) + 1, 0) AS nextSeq FROM ${table} WHERE session_id = ?`)
      .get(sessionId) as { nextSeq: number };
    return row.nextSeq;
  }

  private insertTurn(sessionId: string, turn: SessionTurn, seq: number): void {
    this.database.db
      .prepare(
        `INSERT INTO session_turns
           (session_id, id, seq, input_type, input, narration, dialogues, choices, state_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET
           seq = excluded.seq,
           input_type = excluded.input_type,
           input = excluded.input,
           narration = excluded.narration,
           dialogues = excluded.dialogues,
           choices = excluded.choices,
           state_snapshot = excluded.state_snapshot,
           created_at = excluded.created_at`
      )
      .run(
        sessionId,
        turn.id,
        seq,
        turn.inputType,
        turn.input,
        turn.narration,
        JSON.stringify(turn.dialogues),
        JSON.stringify(turn.choices),
        JSON.stringify(turn.stateSnapshot),
        turn.createdAt
      );
  }

  private insertTimelineNode(sessionId: string, node: TimelineNode, seq: number): void {
    this.database.db
      .prepare(
        `INSERT INTO session_timeline_nodes
           (session_id, id, seq, turn_id, title, summary, state_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET
           seq = excluded.seq,
           turn_id = excluded.turn_id,
           title = excluded.title,
           summary = excluded.summary,
           state_snapshot = excluded.state_snapshot,
           created_at = excluded.created_at`
      )
      .run(
        sessionId,
        node.id,
        seq,
        node.turnId,
        node.title,
        node.summary,
        JSON.stringify(node.stateSnapshot),
        node.createdAt
      );
  }

  private listTurns(sessionId: string): SessionTurn[] {
    const rows = this.database.db
      .prepare(
        `SELECT id, input_type AS inputType, input, narration, dialogues, choices,
                state_snapshot AS stateSnapshot, created_at AS createdAt
         FROM session_turns WHERE session_id = ? ORDER BY seq`
      )
      .all(sessionId) as Array<{
      id: string;
      inputType: string;
      input: string;
      narration: string;
      dialogues: string;
      choices: string;
      stateSnapshot: string;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId,
      inputType: row.inputType as SessionTurn["inputType"],
      input: row.input,
      narration: row.narration,
      dialogues: JSON.parse(row.dialogues) as SessionTurn["dialogues"],
      choices: JSON.parse(row.choices) as SessionTurn["choices"],
      stateSnapshot: JSON.parse(row.stateSnapshot) as WorldState,
      createdAt: row.createdAt
    }));
  }

  private listTimeline(sessionId: string): TimelineNode[] {
    const rows = this.database.db
      .prepare(
        `SELECT id, turn_id AS turnId, title, summary, state_snapshot AS stateSnapshot,
                created_at AS createdAt
         FROM session_timeline_nodes WHERE session_id = ? ORDER BY seq`
      )
      .all(sessionId) as Array<{
      id: string;
      turnId: string;
      title: string;
      summary: string;
      stateSnapshot: string;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId,
      turnId: row.turnId,
      title: row.title,
      summary: row.summary,
      stateSnapshot: JSON.parse(row.stateSnapshot) as WorldState,
      createdAt: row.createdAt
    }));
  }
}
