import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./app-database.js";
import type { ModerationAction, ModerationCategory, ModerationSurface } from "../moderation/checker.js";

export type ModerationStatus = "open" | "resolved" | "dismissed";

export interface ModerationEvent {
  id: string;
  userId: string | null;
  sessionId: string | null;
  storyId: string | null;
  turnId: string | null;
  surface: ModerationSurface;
  action: ModerationAction;
  status: ModerationStatus;
  categories: ModerationCategory[];
  excerpt: string;
  detail: string | null;
  reportedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

export interface RecordModerationInput {
  userId?: string | null;
  sessionId?: string | null;
  storyId?: string | null;
  turnId?: string | null;
  surface: ModerationSurface;
  action: ModerationAction;
  categories: ModerationCategory[];
  excerpt: string;
  detail?: string | null;
  reportedBy?: string | null;
  at?: Date;
}

export interface ModerationCounts {
  open: number;
  blockedToday: number;
  flaggedToday: number;
}

/**
 * Stores moderation decisions. Only outcomes that need attention are persisted:
 * recording every clean generation would turn the queue into a copy of the corpus
 * without telling a reviewer anything.
 */
export class ModerationStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  record(input: RecordModerationInput): ModerationEvent {
    const at = input.at ?? new Date();
    // Blocks are already enforced, so they are an audit trail; flags and reports are
    // the ones a human still has to look at.
    const status: ModerationStatus = input.action === "blocked" ? "resolved" : "open";

    const event: ModerationEvent = {
      id: `mod_${randomUUID()}`,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      storyId: input.storyId ?? null,
      turnId: input.turnId ?? null,
      surface: input.surface,
      action: input.action,
      status,
      categories: input.categories,
      excerpt: input.excerpt,
      detail: input.detail ?? null,
      reportedBy: input.reportedBy ?? null,
      createdAt: at.toISOString(),
      resolvedAt: status === "resolved" ? at.toISOString() : null,
      resolvedBy: status === "resolved" ? "system" : null,
      resolution: status === "resolved" ? "自动拦截" : null
    };

    this.database.db
      .prepare(
        `INSERT INTO moderation_events
           (id, user_id, session_id, story_id, turn_id, surface, action, status, categories,
            excerpt, detail, reported_by, created_at, created_date, resolved_at, resolved_by, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.userId,
        event.sessionId,
        event.storyId,
        event.turnId,
        event.surface,
        event.action,
        event.status,
        JSON.stringify(event.categories),
        event.excerpt,
        event.detail,
        event.reportedBy,
        event.createdAt,
        event.createdAt.slice(0, 10),
        event.resolvedAt,
        event.resolvedBy,
        event.resolution
      );

    return event;
  }

  /** Open events first, since those are the ones still needing a decision. */
  list(options: { status?: ModerationStatus; limit?: number } = {}): ModerationEvent[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

    const rows = options.status
      ? (this.database.db
          .prepare(`${SELECT_EVENT} WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
          .all(options.status, limit) as unknown as EventRow[])
      : (this.database.db
          .prepare(
            `${SELECT_EVENT}
             ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
             LIMIT ?`
          )
          .all(limit) as unknown as EventRow[]);

    return rows.map(toEvent);
  }

  findById(id: string): ModerationEvent | null {
    const row = this.database.db.prepare(`${SELECT_EVENT} WHERE id = ?`).get(id) as unknown as
      | EventRow
      | undefined;
    return row ? toEvent(row) : null;
  }

  /** Returns null when the event does not exist, so callers can answer 404. */
  resolve(
    id: string,
    input: { status: Exclude<ModerationStatus, "open">; resolvedBy: string; resolution?: string | null },
    at: Date = new Date()
  ): ModerationEvent | null {
    const result = this.database.db
      .prepare(
        `UPDATE moderation_events
         SET status = ?, resolved_at = ?, resolved_by = ?, resolution = ?
         WHERE id = ?`
      )
      .run(input.status, at.toISOString(), input.resolvedBy, input.resolution ?? null, id);

    if (Number(result.changes) === 0) {
      return null;
    }

    return this.findById(id);
  }

  counts(at: Date = new Date()): ModerationCounts {
    const date = at.toISOString().slice(0, 10);

    const open = this.database.db
      .prepare("SELECT COUNT(*) AS count FROM moderation_events WHERE status = 'open'")
      .get() as { count: number };

    const today = this.database.db
      .prepare(
        `SELECT
           SUM(CASE WHEN action = 'blocked' THEN 1 ELSE 0 END) AS blocked,
           SUM(CASE WHEN action = 'flagged' THEN 1 ELSE 0 END) AS flagged
         FROM moderation_events WHERE created_date = ?`
      )
      .get(date) as { blocked: number | null; flagged: number | null };

    return {
      open: open.count,
      blockedToday: today.blocked ?? 0,
      flaggedToday: today.flagged ?? 0
    };
  }
}

const SELECT_EVENT = `
  SELECT id, user_id AS userId, session_id AS sessionId, story_id AS storyId, turn_id AS turnId,
         surface, action, status, categories, excerpt, detail, reported_by AS reportedBy,
         created_at AS createdAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy, resolution
  FROM moderation_events
`;

interface EventRow extends Omit<ModerationEvent, "categories"> {
  categories: string;
}

function toEvent(row: EventRow): ModerationEvent {
  return {
    ...row,
    categories: JSON.parse(row.categories) as ModerationCategory[]
  };
}
