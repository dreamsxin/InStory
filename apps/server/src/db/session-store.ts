import type {
  ReaderRole,
  SessionTurn,
  StoryReadingInsight,
  StorySession,
  TimelineNode,
  WorldState
} from "@instory/shared";
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
  /**
   * The story's title as it was when the reader opened it. Snapshotted on the
   * session so a deleted story leaves a card the reader can still recognise.
   */
  storyTitle: string;
}


export interface AppendTurnInput {
  turn: SessionTurn;
  state: WorldState;
  timelineNode?: TimelineNode | null;
  updatedAt: string;
  /**
   * The plot anchor this passage advanced, when the model named a real one. Kept
   * beside the turn rather than on `SessionTurn`, because that type goes to readers
   * and the anchor list is the author's outline.
   */
  anchorId?: string | null;
  /**
   * The author's preset passage this turn served, when it served one instead of
   * calling the model. Also beside the turn rather than on `SessionTurn`: which
   * passage of the outline a reader is on is the author's business, and it is what
   * tells the next 继续阅读 where the reading has got to.
   */
  segmentId?: string | null;
}


/**
 * How much of a session's history to materialise. Omitting a field loads all of it,
 * which is what rewind needs; the reader and the generation path pass a window so a
 * long story does not cost a full transcript on every request.
 */
export interface SessionReadWindow {
  recentTurns?: number;
  recentTimelineNodes?: number;
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

  /**
   * Inserts a session together with its initial turns and timeline nodes. The story
   * title is taken as given: it is a snapshot of what the reader opened, not a live
   * reference, so it must not be re-read from the story later.
   */
  create(session: StorySession, userId: string, storyTitle: string): void {
    this.database.db.exec("BEGIN");
    try {
      this.database.db
        .prepare(
          `INSERT INTO reader_sessions
             (id, story_id, story_title, user_id, reader_role, state, turn_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             story_id = excluded.story_id,
             story_title = excluded.story_title,
             user_id = excluded.user_id,
             reader_role = excluded.reader_role,
             state = excluded.state,
             turn_count = excluded.turn_count,
             updated_at = excluded.updated_at`
        )
        .run(
          session.id,
          session.storyId,
          storyTitle,
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
      this.insertTurn(sessionId, input.turn, turnSeq, input.anchorId ?? null, input.segmentId ?? null);


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
   * Carries the markers of copied turns onto a branch, matching on turn id. A rewind
   * copies the passages themselves, so leaving these null would lose what the
   * surviving transcript still shows:
   *
   * - `anchor_id`: the author's reach report would keep the beat only in the session
   *   the reader branched away from, and lose it the moment they delete that one.
   * - `segment_id`: the branch would look as if it had read none of the author's
   *   preset passages, so 继续阅读 would serve the first one again - the reader would
   *   be handed a passage they have already read.
   *
   * Never overwrites a marker already there.
   */
  copyTurnMarkers(fromSessionId: string, toSessionId: string): void {
    this.database.db
      .prepare(
        `UPDATE session_turns
            SET anchor_id = COALESCE(anchor_id, (SELECT source.anchor_id FROM session_turns AS source
                              WHERE source.session_id = ? AND source.id = session_turns.id)),
                segment_id = COALESCE(segment_id, (SELECT source.segment_id FROM session_turns AS source
                              WHERE source.session_id = ? AND source.id = session_turns.id))
          WHERE session_id = ?`
      )
      .run(fromSessionId, fromSessionId, toSessionId);
  }

  /**
   * Which of the author's preset passages this reading has already been served. The
   * next 继续阅读 takes the first passage of the story that is not in here, so a
   * rewind that dropped a passage lets it be read again - which is what a rewind is.
   */
  listServedSegmentIds(sessionId: string): Set<string> {
    const rows = this.database.db
      .prepare("SELECT segment_id AS segmentId FROM session_turns WHERE session_id = ? AND segment_id IS NOT NULL")
      .all(sessionId) as Array<{ segmentId: string }>;
    return new Set(rows.map((row) => row.segmentId));
  }

  /**
   * Reads a session. Pass ownerId to require the session to belong to that user;
   * omitting it is only appropriate for admin-facing reads. Pass a window to load
   * only the newest turns and timeline nodes; without one the whole history is read.
   */
  findById(id: string, ownerId?: string, window: SessionReadWindow = {}): StorySession | null {
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
      turns: this.listTurns(id, window.recentTurns),
      timeline: this.listTimeline(id, window.recentTimelineNodes),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  count(): number {
    const row = this.database.db.prepare("SELECT COUNT(*) AS count FROM reader_sessions").get() as { count: number };
    return row.count;
  }

  /**
   * Removes a reading session and everything written under it. Scoped by owner on
   * purpose: the id alone must never be enough to delete someone else's reading.
   */
  deleteOwned(sessionId: string, ownerId: string): boolean {
    const owned = this.database.db
      .prepare("SELECT 1 AS found FROM reader_sessions WHERE id = ? AND user_id = ?")
      .get(sessionId, ownerId) as { found: number } | undefined;
    if (!owned) {
      return false;
    }

    this.database.db.exec("BEGIN");
    try {
      this.database.db.prepare("DELETE FROM session_timeline_nodes WHERE session_id = ?").run(sessionId);
      this.database.db.prepare("DELETE FROM session_turns WHERE session_id = ?").run(sessionId);
      const result = this.database.db.prepare("DELETE FROM reader_sessions WHERE id = ?").run(sessionId);
      this.database.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.database.db.exec("ROLLBACK");
      throw error;
    }
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
                s.turn_count AS turnCount, s.reader_role AS readerRole, s.story_title AS storyTitle,
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
      storyTitle: string | null;
      latestNarration: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      storyId: row.storyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      turnCount: row.turnCount,
      readerRoleName: (JSON.parse(row.readerRole ?? "{}") as Partial<ReaderRole>).name ?? "读者",
      storyTitle: row.storyTitle ?? "已删除的故事",
      latestNarration: row.latestNarration
    }));
  }

  /** Whether the reader already has a session in the story. */
  hasSessionForStory(userId: string, storyId: string): boolean {
    const row = this.database.db
      .prepare("SELECT 1 AS present FROM reader_sessions WHERE user_id = ? AND story_id = ? LIMIT 1")
      .get(userId, storyId) as { present: number } | undefined;
    return row !== undefined;
  }

  /**
   * The story title recorded on a session. A branch or a restart inherits it from
   * the session it came from: same reading, same recorded title, and no second
   * lookup that could disagree with the first.
   */
  findStoryTitle(sessionId: string): string | null {
    const row = this.database.db
      .prepare("SELECT story_title AS storyTitle FROM reader_sessions WHERE id = ?")
      .get(sessionId) as { storyTitle: string | null } | undefined;
    return row?.storyTitle ?? null;
  }


  get databasePath(): string {
    return this.database.databasePath;
  }


  /**
   * How far the given stories carried readers. Aggregates only, and each story's own
   * author is excluded: counting an author's trials as readers would make every
   * unread story look like it had an audience, which is the one thing this number
   * exists to answer honestly. Stories with no reader at all come back as zeros
   * rather than omitted, so the caller does not have to tell "no readers" apart from
   * "no row".
   *
   * The exclusion is per story rather than one id for the whole query, because a
   * public shelf mixes stories with different authors.
   */
  summarizeStories(entries: Array<{ storyId: string; ownerId: string | null }>): StoryReadingInsight[] {
    const empty = (storyId: string): StoryReadingInsight => ({
      storyId,
      readers: 0,
      sessions: 0,
      turns: 0,
      deepestTurns: 0,
      lastReadAt: null,
      anchorReach: []
    });


    if (entries.length === 0) {
      return [];
    }

    // No real user id is the empty string, so a story without an author excludes
    // nobody.
    const conditions = entries.map(() => "(story_id = ? AND user_id <> ?)").join(" OR ");
    const params = entries.flatMap((entry) => [entry.storyId, entry.ownerId ?? ""]);
    const rows = this.database.db
      .prepare(
        `SELECT story_id AS storyId,
                COUNT(DISTINCT user_id) AS readers,
                COUNT(*) AS sessions,
                COALESCE(SUM(turn_count), 0) AS turns,
                COALESCE(MAX(turn_count), 0) AS deepestTurns,
                MAX(updated_at) AS lastReadAt
         FROM reader_sessions
         WHERE ${conditions}
         GROUP BY story_id`
      )
      .all(...params) as Array<{
      storyId: string;
      readers: number;
      sessions: number;
      turns: number;
      deepestTurns: number;
      lastReadAt: string | null;
    }>;

    const byStoryId = new Map(rows.map((row) => [row.storyId, row]));

    /**
     * Which planned beats readers actually reached, by the same per-story author
     * exclusion. Joined through the session so one reader who hit a beat in three
     * sessions still counts once.
     */
    const reachConditions = entries.map(() => "(s.story_id = ? AND s.user_id <> ?)").join(" OR ");
    const reachRows = this.database.db
      .prepare(
        `SELECT s.story_id AS storyId,
                t.anchor_id AS anchorId,
                COUNT(DISTINCT s.user_id) AS readers
           FROM session_turns t
           JOIN reader_sessions s ON s.id = t.session_id
          WHERE t.anchor_id IS NOT NULL AND (${reachConditions})
          GROUP BY s.story_id, t.anchor_id
          ORDER BY readers DESC`
      )
      .all(...params) as Array<{ storyId: string; anchorId: string; readers: number }>;


    const reachByStoryId = new Map<string, Array<{ anchorId: string; readers: number }>>();
    for (const row of reachRows) {
      const list = reachByStoryId.get(row.storyId) ?? [];
      list.push({ anchorId: row.anchorId, readers: row.readers });
      reachByStoryId.set(row.storyId, list);
    }

    return entries.map((entry) => {
      const row = byStoryId.get(entry.storyId);
      const anchorReach = reachByStoryId.get(entry.storyId) ?? [];
      return row
        ? { ...row, lastReadAt: row.lastReadAt ?? null, anchorReach }
        : { ...empty(entry.storyId), anchorReach };
    });
  }

  /**
   * Just the two figures the shelf orders by, for every story that has been read, in
   * one query. `summarizeStories` answers the same question in more detail, but it
   * builds one OR clause per story id, so ordering a shelf of a few hundred stories
   * through it would mean a few hundred clauses to compute numbers that are then
   * thrown away for everything outside the page. Ordering needs the keys for the
   * whole matched set; the details are only needed for the page that is shown.
   *
   * The author exclusion joins the story's own payload rather than taking a viewer
   * id, so it stays per story - a public shelf mixes stories with different authors,
   * and an author opening their own draft is not an audience for it.
   */
  summarizeStoryOrderKeys(): Map<string, { readers: number; lastReadAt: string | null }> {
    const rows = this.database.db
      .prepare(
        `SELECT s.story_id AS storyId,
                COUNT(DISTINCT s.user_id) AS readers,
                MAX(s.updated_at) AS lastReadAt
           FROM reader_sessions s
           JOIN stories st ON st.id = s.story_id
          WHERE s.user_id <> COALESCE(json_extract(st.payload, '$.ownerId'), '')
          GROUP BY s.story_id`
      )
      .all() as Array<{ storyId: string; readers: number; lastReadAt: string | null }>;

    return new Map(rows.map((row) => [row.storyId, { readers: row.readers, lastReadAt: row.lastReadAt ?? null }]));
  }





  /** Total turns in a session, read from the denormalised counter. */
  countTurns(sessionId: string): number {
    const row = this.database.db
      .prepare("SELECT turn_count AS turnCount FROM reader_sessions WHERE id = ?")
      .get(sessionId) as { turnCount: number } | undefined;
    return row?.turnCount ?? 0;
  }

  /**
   * Turns immediately older than the given one, oldest first. Used to walk backwards
   * through a long transcript instead of shipping all of it at once. Returns an empty
   * array when the cursor turn does not belong to the session.
   */
  listTurnsBefore(sessionId: string, beforeTurnId: string, limit: number): SessionTurn[] {
    const cursor = this.database.db
      .prepare("SELECT seq FROM session_turns WHERE session_id = ? AND id = ?")
      .get(sessionId, beforeTurnId) as { seq: number } | undefined;

    if (!cursor) {
      return [];
    }

    const rows = this.database.db
      .prepare(
        `SELECT id, input_type AS inputType, input, narration, dialogues, choices,
                state_snapshot AS stateSnapshot, intervention, created_at AS createdAt
         FROM session_turns
         WHERE session_id = ? AND seq < ?
         ORDER BY seq DESC
         LIMIT ?`
      )
      .all(sessionId, cursor.seq, Math.max(0, limit))
      .reverse() as Array<{
      id: string;
      inputType: string;
      input: string;
      narration: string;
      dialogues: string;
      choices: string;
      stateSnapshot: string;
      intervention: string | null;
      createdAt: string;
    }>;

    return rows.map((row) => this.toTurn(sessionId, row));
  }

  /** Whether any turn in the session is older than the given one. */
  hasTurnsBefore(sessionId: string, beforeTurnId: string): boolean {
    const cursor = this.database.db
      .prepare("SELECT seq FROM session_turns WHERE session_id = ? AND id = ?")
      .get(sessionId, beforeTurnId) as { seq: number } | undefined;

    if (!cursor) {
      return false;
    }

    const row = this.database.db
      .prepare("SELECT 1 AS present FROM session_turns WHERE session_id = ? AND seq < ? LIMIT 1")
      .get(sessionId, cursor.seq) as { present: number } | undefined;

    return row !== undefined;
  }

  /**
   * One turn by id, or the newest turn when no id is given. Lets callers that only
   * need a single turn — reporting a passage, for instance — avoid materialising the
   * transcript just to search it in memory.
   */
  findTurn(sessionId: string, turnId?: string | null): SessionTurn | null {
    const row = (
      turnId
        ? this.database.db
            .prepare(
              `SELECT id, input_type AS inputType, input, narration, dialogues, choices,
                      state_snapshot AS stateSnapshot, intervention, created_at AS createdAt
               FROM session_turns WHERE session_id = ? AND id = ?`
            )
            .get(sessionId, turnId)
        : this.database.db
            .prepare(
              `SELECT id, input_type AS inputType, input, narration, dialogues, choices,
                      state_snapshot AS stateSnapshot, intervention, created_at AS createdAt
               FROM session_turns WHERE session_id = ? ORDER BY seq DESC LIMIT 1`
            )
            .get(sessionId)
    ) as
      | {
          id: string;
          inputType: string;
          input: string;
          narration: string;
          dialogues: string;
          choices: string;
          stateSnapshot: string;
          intervention: string | null;
          createdAt: string;
        }
      | undefined;

    return row ? this.toTurn(sessionId, row) : null;
  }

  private nextSeq(table: "session_turns" | "session_timeline_nodes", sessionId: string): number {
    const row = this.database.db
      .prepare(`SELECT COALESCE(MAX(seq) + 1, 0) AS nextSeq FROM ${table} WHERE session_id = ?`)
      .get(sessionId) as { nextSeq: number };
    return row.nextSeq;
  }

  private insertTurn(
    sessionId: string,
    turn: SessionTurn,
    seq: number,
    anchorId: string | null = null,
    segmentId: string | null = null
  ): void {
    this.database.db
      .prepare(
        `INSERT INTO session_turns
           (session_id, id, seq, input_type, input, narration, dialogues, choices, state_snapshot, intervention, anchor_id, segment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, id) DO UPDATE SET
           seq = excluded.seq,
           input_type = excluded.input_type,
           input = excluded.input,
           narration = excluded.narration,
           dialogues = excluded.dialogues,
           choices = excluded.choices,
           state_snapshot = excluded.state_snapshot,
           intervention = excluded.intervention,
           -- Rewriting a session (rewind, reset) re-inserts the turns it keeps without
           -- knowing their beats, so a missing value must not erase what was reported.
           anchor_id = COALESCE(excluded.anchor_id, session_turns.anchor_id),
           -- Same for the preset passage a turn served: erasing it would let the reader
           -- be served a passage they have already read.
           segment_id = COALESCE(excluded.segment_id, session_turns.segment_id),
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
        // NULL rather than "null": an ordinary passage has no cue, and the column
        // should say so without a reader having to parse it.
        turn.intervention ? JSON.stringify(turn.intervention) : null,
        anchorId,
        segmentId,
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

  private listTurns(sessionId: string, recent?: number): SessionTurn[] {
    // Windowed reads take the newest rows and flip them back, because "the last N"
    // cannot be expressed with a plain ascending LIMIT.
    const rows = (
      recent === undefined
        ? this.database.db
            .prepare(
              `SELECT id, input_type AS inputType, input, narration, dialogues, choices,
                      state_snapshot AS stateSnapshot, intervention, created_at AS createdAt
               FROM session_turns WHERE session_id = ? ORDER BY seq`
            )
            .all(sessionId)
        : this.database.db
            .prepare(
              `SELECT id, input_type AS inputType, input, narration, dialogues, choices,
                      state_snapshot AS stateSnapshot, intervention, created_at AS createdAt
               FROM session_turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?`
            )
            .all(sessionId, Math.max(0, recent))
            .reverse()
    ) as Array<{
      id: string;
      inputType: string;
      input: string;
      narration: string;
      dialogues: string;
      choices: string;
      stateSnapshot: string;
      intervention: string | null;
      createdAt: string;
    }>;

    return rows.map((row) => this.toTurn(sessionId, row));
  }

  private toTurn(
    sessionId: string,
    row: {
      id: string;
      inputType: string;
      input: string;
      narration: string;
      dialogues: string;
      choices: string;
      stateSnapshot: string;
      intervention: string | null;
      createdAt: string;
    }
  ): SessionTurn {
    return {
      id: row.id,
      sessionId,
      inputType: row.inputType as SessionTurn["inputType"],
      input: row.input,
      narration: row.narration,
      dialogues: JSON.parse(row.dialogues) as SessionTurn["dialogues"],
      choices: JSON.parse(row.choices) as SessionTurn["choices"],
      stateSnapshot: JSON.parse(row.stateSnapshot) as WorldState,
      intervention: row.intervention ? (JSON.parse(row.intervention) as SessionTurn["intervention"]) : null,
      createdAt: row.createdAt
    };
  }

  private listTimeline(sessionId: string, recent?: number): TimelineNode[] {
    const rows = (
      recent === undefined
        ? this.database.db
            .prepare(
              `SELECT id, turn_id AS turnId, title, summary, state_snapshot AS stateSnapshot,
                      created_at AS createdAt
               FROM session_timeline_nodes WHERE session_id = ? ORDER BY seq`
            )
            .all(sessionId)
        : this.database.db
            .prepare(
              `SELECT id, turn_id AS turnId, title, summary, state_snapshot AS stateSnapshot,
                      created_at AS createdAt
               FROM session_timeline_nodes WHERE session_id = ? ORDER BY seq DESC LIMIT ?`
            )
            .all(sessionId, Math.max(0, recent))
            .reverse()
    ) as Array<{
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
