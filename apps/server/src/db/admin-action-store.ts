import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./app-database.js";

/** What an operator did. Kept coarse on purpose: one row per real decision. */
export type AdminActionKind = "story_takedown" | "revoke_sessions" | "role_change";

export interface AdminAction {
  id: string;
  /** Null when the call authenticated with ADMIN_TOKEN, which has no person behind it. */
  actorId: string | null;
  actorEmail: string | null;
  action: AdminActionKind;
  targetType: "story" | "user";
  targetId: string;
  /** A title or an address, so the row stays readable after the target changes. */
  targetLabel: string | null;
  detail: string | null;
  createdAt: string;
}

export interface RecordAdminActionInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AdminActionKind;
  targetType: "story" | "user";
  targetId: string;
  targetLabel?: string | null;
  detail?: string | null;
  at?: Date;
}

const SELECT_ACTION = `
  SELECT id,
         actor_id AS actorId,
         actor_email AS actorEmail,
         action,
         target_type AS targetType,
         target_id AS targetId,
         target_label AS targetLabel,
         detail,
         created_at AS createdAt
    FROM admin_actions
`;

/**
 * The audit trail for operator actions. Append-only: there is no update and no delete,
 * because a record that can be tidied up answers nothing later.
 */
export class AdminActionStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  record(input: RecordAdminActionInput): AdminAction {
    const at = input.at ?? new Date();
    const action: AdminAction = {
      id: `adm_${randomUUID()}`,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel ?? null,
      detail: input.detail ?? null,
      createdAt: at.toISOString()
    };

    this.database.db
      .prepare(
        `INSERT INTO admin_actions
           (id, actor_id, actor_email, action, target_type, target_id, target_label, detail,
            created_at, created_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        action.id,
        action.actorId,
        action.actorEmail,
        action.action,
        action.targetType,
        action.targetId,
        action.targetLabel,
        action.detail,
        action.createdAt,
        action.createdAt.slice(0, 10)
      );

    return action;
  }

  /** Newest first, capped: the console shows a page, not the whole history. */
  list(limit = 50): AdminAction[] {
    return this.database.db
      .prepare(`${SELECT_ACTION} ORDER BY created_at DESC LIMIT ?`)
      .all(Math.max(1, Math.min(200, Math.trunc(limit)))) as unknown as AdminAction[];
  }

  /** Everything ever done to one story or account, for answering "what happened here". */
  listForTarget(targetType: "story" | "user", targetId: string, limit = 50): AdminAction[] {
    return this.database.db
      .prepare(`${SELECT_ACTION} WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(targetType, targetId, Math.max(1, Math.min(200, Math.trunc(limit)))) as unknown as AdminAction[];
  }
}
