import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  id: number;
  name: string;
  /**
   * Either a SQL script or, for migrations that have to reshape existing rows,
   * a function that runs inside the migration transaction. Data migrations need
   * the function form because the legacy rows keep their business fields inside a
   * JSON payload column, which SQL alone cannot reliably destructure.
   */
  up: string | ((db: DatabaseSync) => void);
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
  },
  {
    id: 3,
    name: "normalize_session_turns_and_timeline",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_turns (
          session_id TEXT NOT NULL,
          id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          input_type TEXT NOT NULL,
          input TEXT NOT NULL,
          narration TEXT NOT NULL,
          dialogues TEXT NOT NULL,
          choices TEXT NOT NULL,
          state_snapshot TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (session_id, id),
          FOREIGN KEY(session_id) REFERENCES reader_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_session_turns_session_seq
        ON session_turns(session_id, seq);

        CREATE TABLE IF NOT EXISTS session_timeline_nodes (
          session_id TEXT NOT NULL,
          id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          turn_id TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          state_snapshot TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (session_id, id),
          FOREIGN KEY(session_id) REFERENCES reader_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_session_timeline_nodes_session_seq
        ON session_timeline_nodes(session_id, seq);
      `);

      // reader_role and state stay nullable because SQLite cannot add a NOT NULL
      // column without a default; the store always writes both.
      for (const column of [
        "ALTER TABLE reader_sessions ADD COLUMN reader_role TEXT",
        "ALTER TABLE reader_sessions ADD COLUMN state TEXT",
        "ALTER TABLE reader_sessions ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0"
      ]) {
        db.exec(column);
      }

      backfillSessionsFromPayload(db);

      db.exec("ALTER TABLE reader_sessions DROP COLUMN payload");
    }
  },
  {
    id: 4,
    name: "add_users_and_auth_sessions",
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_normalized TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'reader',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Only the SHA-256 of the opaque session token is stored, so a database leak
      -- does not hand out usable sessions.
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
      ON auth_sessions(user_id);

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
      ON auth_sessions(expires_at);

      -- Existing rows already carry owner_id = 'local-reader'. Seeding that id as a
      -- real user turns the old placeholder into a proper account instead of
      -- requiring a data backfill. The password hash is intentionally unusable, so
      -- nobody can sign in as it.
      INSERT OR IGNORE INTO users (id, email, email_normalized, display_name, password_hash, role, created_at, updated_at)
      VALUES (
        'local-reader',
        'legacy@instory.local',
        'legacy@instory.local',
        '本地读者',
        'disabled',
        'reader',
        '1970-01-01T00:00:00.000Z',
        '1970-01-01T00:00:00.000Z'
      );
    `
  },
  {
    id: 5,
    name: "attach_reader_sessions_to_users",
    up: `
      -- Reading sessions had no owner at all, so any caller could list or open any
      -- other reader's session. The default backfills existing rows onto the seeded
      -- legacy user.
      ALTER TABLE reader_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local-reader';

      CREATE INDEX IF NOT EXISTS idx_reader_sessions_user_updated_at
      ON reader_sessions(user_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_reader_sessions_user_story
      ON reader_sessions(user_id, story_id, updated_at DESC);
    `
  },
  {
    id: 6,
    name: "add_generation_usage",
    up: `
      -- One row per generation attempt, so token spend and failure rate are visible
      -- instead of being invisible side effects of a request.
      CREATE TABLE IF NOT EXISTS generation_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        story_id TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        intent TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        -- Stored as YYYY-MM-DD so daily rollups are an index lookup rather than a
        -- scan with date arithmetic.
        created_date TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_generation_usage_user_date
      ON generation_usage(user_id, created_date);

      CREATE INDEX IF NOT EXISTS idx_generation_usage_date
      ON generation_usage(created_date);
    `
  },
  {
    id: 7,
    name: "add_moderation_events",
    up: `
      -- One row per moderation decision, including the ones that passed, so the
      -- review queue and the audit trail are the same table.
      CREATE TABLE IF NOT EXISTS moderation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        session_id TEXT,
        story_id TEXT,
        turn_id TEXT,
        surface TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        categories TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        detail TEXT,
        reported_by TEXT,
        created_at TEXT NOT NULL,
        created_date TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT,
        resolution TEXT
      );

      -- The review queue reads open events newest first.
      CREATE INDEX IF NOT EXISTS idx_moderation_events_status_created
      ON moderation_events(status, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_moderation_events_date
      ON moderation_events(created_date);

      CREATE INDEX IF NOT EXISTS idx_moderation_events_user
      ON moderation_events(user_id, created_at DESC);
    `
  },
  {
    id: 8,
    name: "add_turn_intervention",
    up: `
      -- A passage may end at a key node (§5.3): an actor asks something, a clue
      -- surfaces, a crisis closes in. Nullable because most passages are just
      -- story, and every turn written before this column was just story too.
      ALTER TABLE session_turns ADD COLUMN intervention TEXT;
    `
  },
  {
    id: 9,
    name: "snapshot_story_title_on_sessions",
    up: (db) => {
      // A session recorded only the story id, so its title came from a join. When an
      // author deleted a story the join found nothing and the reader's progress card
      // silently disappeared. The title is what a reader recognises the reading by,
      // so the session now keeps its own copy.
      db.exec("ALTER TABLE reader_sessions ADD COLUMN story_title TEXT");

      const rows = db.prepare("SELECT id, payload FROM stories").all() as Array<{
        id: string;
        payload: string;
      }>;
      const update = db.prepare("UPDATE reader_sessions SET story_title = ? WHERE story_id = ?");

      for (const row of rows) {
        try {
          const title = (JSON.parse(row.payload) as { title?: unknown }).title;
          if (typeof title === "string" && title.trim()) {
            update.run(title, row.id);
          }
        } catch {
          // A story whose payload will not parse leaves its sessions untitled rather
          // than aborting the whole migration.
        }
      }

      // Sessions whose story was already gone get the only honest label available.
      db.exec("UPDATE reader_sessions SET story_title = '已删除的故事' WHERE story_title IS NULL");
    }
  },
  {
    id: 10,
    name: "add_admin_actions",
    up: `
      -- What operators did to other people's things. The console had grown two real
      -- powers - taking a story off the shelf and ending an account's logins - and
      -- neither left anything a second operator could look up afterwards: one warn
      -- line in a log that rotates, and for takedowns a sentence on the event row.
      --
      -- Append-only by intent: rows are never updated or deleted, because the point of
      -- an audit trail is that it cannot be tidied up.
      CREATE TABLE IF NOT EXISTS admin_actions (
        id TEXT PRIMARY KEY,
        -- Null when the caller authenticated with ADMIN_TOKEN instead of an account:
        -- the shared credential has no person behind it, and pretending otherwise
        -- would be the one lie an audit table must not tell.
        actor_id TEXT,
        actor_email TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        -- Human-readable, for the console: story titles and account addresses change
        -- or disappear, and a row that only holds ids stops being readable.
        target_label TEXT,
        detail TEXT,
        created_at TEXT NOT NULL,
        created_date TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_admin_actions_created
      ON admin_actions(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_admin_actions_target
      ON admin_actions(target_type, target_id, created_at DESC);
    `
  }
];


/**
 * Moves turns and timeline nodes out of the legacy reader_sessions.payload blob
 * into their own rows. Rows whose payload cannot be parsed are left with an empty
 * history rather than aborting the whole migration, so a single corrupt session
 * cannot block a deployment.
 */
function backfillSessionsFromPayload(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, payload FROM reader_sessions").all() as Array<{
    id: string;
    payload: string;
  }>;

  const insertTurn = db.prepare(
    `INSERT OR IGNORE INTO session_turns
       (session_id, id, seq, input_type, input, narration, dialogues, choices, state_snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertNode = db.prepare(
    `INSERT OR IGNORE INTO session_timeline_nodes
       (session_id, id, seq, turn_id, title, summary, state_snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateSession = db.prepare(
    "UPDATE reader_sessions SET reader_role = ?, state = ?, turn_count = ? WHERE id = ?"
  );

  for (const row of rows) {
    let session: {
      readerRole?: unknown;
      state?: unknown;
      turns?: Array<Record<string, unknown>>;
      timeline?: Array<Record<string, unknown>>;
    };

    try {
      session = JSON.parse(row.payload);
    } catch {
      updateSession.run(JSON.stringify({}), JSON.stringify({}), 0, row.id);
      continue;
    }

    const turns = Array.isArray(session.turns) ? session.turns : [];
    const timeline = Array.isArray(session.timeline) ? session.timeline : [];

    turns.forEach((turn, index) => {
      insertTurn.run(
        row.id,
        String(turn.id ?? `turn_${index}`),
        index,
        String(turn.inputType ?? "free_text"),
        String(turn.input ?? ""),
        String(turn.narration ?? ""),
        JSON.stringify(turn.dialogues ?? []),
        JSON.stringify(turn.choices ?? []),
        JSON.stringify(turn.stateSnapshot ?? {}),
        String(turn.createdAt ?? "")
      );
    });

    timeline.forEach((node, index) => {
      insertNode.run(
        row.id,
        String(node.id ?? `node_${index}`),
        index,
        String(node.turnId ?? ""),
        String(node.title ?? ""),
        String(node.summary ?? ""),
        JSON.stringify(node.stateSnapshot ?? {}),
        String(node.createdAt ?? "")
      );
    });

    updateSession.run(
      JSON.stringify(session.readerRole ?? {}),
      JSON.stringify(session.state ?? {}),
      turns.length,
      row.id
    );
  }
}

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
      if (typeof migration.up === "string") {
        db.exec(migration.up);
      } else {
        migration.up(db);
      }
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
