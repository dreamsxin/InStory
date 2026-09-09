import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./app-database.js";
import { appliedMigrationIds, migrations, runMigrations } from "./migrations.js";
import { SessionStore } from "./session-store.js";

const tempDirs: string[] = [];

/** Migration 1 is the pre-migration-runner schema; the tests replay it as raw SQL. */
function initialSchemaSql(): string {
  const up = migrations[0]!.up;
  if (typeof up !== "string") {
    throw new Error("migration 1 is expected to be a SQL script");
  }
  return up;
}

function createTempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "instory-migrations-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("migration runner", () => {
  it("uses a gapless, ascending, unique id sequence", () => {
    const ids = migrations.map((migration) => migration.id);

    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toEqual(migrations.map((_, index) => index + 1));
  });

  it("applies every migration on a fresh database", () => {
    const database = new AppDatabase(createTempDatabasePath());

    expect(database.appliedMigrations).toEqual(migrations.map((migration) => migration.id));
    expect(appliedMigrationIds(database.db)).toEqual(migrations.map((migration) => migration.id));

    database.close();
  });

  it("is idempotent across restarts", () => {
    const databasePath = createTempDatabasePath();

    const first = new AppDatabase(databasePath);
    expect(first.appliedMigrations.length).toBe(migrations.length);
    first.close();

    const second = new AppDatabase(databasePath);
    expect(second.appliedMigrations).toEqual([]);
    expect(appliedMigrationIds(second.db)).toEqual(migrations.map((migration) => migration.id));
    second.close();
  });

  it("creates every table the stores depend on", () => {
    const database = new AppDatabase(createTempDatabasePath());

    const tables = (
      database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((row) => row.name);

    for (const table of [
      "schema_migrations",
      "stories",
      "worlds",
      "characters",
      "story_anchors",
      "reader_sessions",
      "session_turns",
      "session_timeline_nodes",
      "reader_profiles",
      "model_config"
    ]) {
      expect(tables).toContain(table);
    }

    database.close();
  });

  it("adopts a legacy database that already has the initial tables", () => {
    const databasePath = createTempDatabasePath();

    // Simulate the pre-migration schema created inline by the old store constructors.
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(initialSchemaSql());
    legacy.close();

    const database = new AppDatabase(databasePath);

    expect(database.appliedMigrations).toEqual(migrations.map((migration) => migration.id));

    database.close();
  });

  it("moves a legacy session payload into the normalized tables", () => {
    const databasePath = createTempDatabasePath();

    const legacy = new DatabaseSync(databasePath);
    legacy.exec(initialSchemaSql());
    legacy
      .prepare(
        "INSERT INTO reader_sessions (id, story_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "sess_legacy",
        "rain-mansion",
        JSON.stringify({
          id: "sess_legacy",
          storyId: "rain-mansion",
          readerRole: { mode: "existing_character", name: "陆清河", description: "旧宅管事" },
          state: { scene: "雨夜醒来", location: "旧宅东厢房", turnCount: 2 },
          turns: [
            {
              id: "turn_0",
              inputType: "free_text",
              input: "进入故事",
              narration: "第一段",
              dialogues: [],
              choices: [],
              stateSnapshot: { turnCount: 0 },
              createdAt: "2026-05-20T00:00:00.000Z"
            },
            {
              id: "turn_1",
              inputType: "choice",
              input: "继续",
              narration: "第二段",
              dialogues: [],
              choices: [],
              stateSnapshot: { turnCount: 1 },
              createdAt: "2026-05-20T00:01:00.000Z"
            }
          ],
          timeline: [
            {
              id: "node_0",
              turnId: "turn_0",
              title: "雨夜醒来",
              summary: "你醒来。",
              stateSnapshot: { turnCount: 0 },
              createdAt: "2026-05-20T00:00:00.000Z"
            }
          ]
        }),
        "2026-05-20T00:00:00.000Z",
        "2026-05-20T00:01:00.000Z"
      );
    legacy.close();

    const database = new AppDatabase(databasePath);
    const store = new SessionStore(database);
    const session = store.findById("sess_legacy");

    expect(session?.readerRole.name).toBe("陆清河");
    expect(session?.turns.map((turn) => turn.narration)).toEqual(["第一段", "第二段"]);
    expect(session?.timeline.map((node) => node.id)).toEqual(["node_0"]);
    expect(store.listRecent()[0]?.turnCount).toBe(2);

    // The legacy payload column is gone, so there is only one source of truth.
    const columns = (
      database.db.prepare("SELECT name FROM pragma_table_info('reader_sessions')").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(columns).not.toContain("payload");

    database.close();
  });

  it("survives a legacy session whose payload cannot be parsed", () => {
    const databasePath = createTempDatabasePath();

    const legacy = new DatabaseSync(databasePath);
    legacy.exec(initialSchemaSql());
    legacy
      .prepare(
        "INSERT INTO reader_sessions (id, story_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("sess_broken", "rain-mansion", "{not json", "2026-05-20T00:00:00.000Z", "2026-05-20T00:00:00.000Z");
    legacy.close();

    const database = new AppDatabase(databasePath);

    expect(database.appliedMigrations).toEqual(migrations.map((migration) => migration.id));
    expect(new SessionStore(database).findById("sess_broken")?.turns).toEqual([]);

    database.close();
  });

  it("labels the usage rows an author's own trials left behind", () => {
    const databasePath = createTempDatabasePath();
    const db = new DatabaseSync(databasePath);

    // Everything up to the one under test, so the old rows exist without the column.
    runMigrations(db, migrations.filter((migration) => migration.id < 12));

    db.prepare("INSERT INTO stories (id, payload) VALUES (?, ?)").run(
      "owned",
      JSON.stringify({ id: "owned", title: "作者的故事", ownerId: "author" })
    );
    db.prepare("INSERT INTO stories (id, payload) VALUES (?, ?)").run(
      "platform",
      JSON.stringify({ id: "platform", title: "平台故事", ownerId: null })
    );

    const insert = db.prepare(
      `INSERT INTO generation_usage
         (id, user_id, story_id, provider, intent, status, created_at, created_date)
       VALUES (?, ?, ?, 'mock', 'read_segment', 'success', '2026-05-20T00:00:00.000Z', '2026-05-20')`
    );
    insert.run("u_trial", "author", "owned");
    insert.run("u_read", "reader", "owned");
    insert.run("u_platform", "author", "platform");
    insert.run("u_deleted", "author", "gone");

    runMigrations(db, migrations);

    const flags = new Map(
      (
        db.prepare("SELECT id, is_author_trial AS flag FROM generation_usage").all() as Array<{
          id: string;
          flag: number;
        }>
      ).map((row) => [row.id, row.flag])
    );

    // Derived, not guessed: the author's own turn on their own story is the trial.
    expect(flags.get("u_trial")).toBe(1);
    expect(flags.get("u_read")).toBe(0);
    // A platform story has no author to be, and a story that is gone cannot be asked.
    expect(flags.get("u_platform")).toBe(0);
    expect(flags.get("u_deleted")).toBe(0);

    db.close();
  });

  it("rolls back and leaves the ledger untouched when a migration fails", () => {

    const databasePath = createTempDatabasePath();
    const db = new DatabaseSync(databasePath);

    expect(() =>
      runMigrations(db, [
        { id: 1, name: "ok", up: "CREATE TABLE ok_table (id TEXT PRIMARY KEY);" },
        { id: 2, name: "broken", up: "THIS IS NOT VALID SQL;" }
      ])
    ).toThrow();

    expect(appliedMigrationIds(db)).toEqual([]);

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name
    );
    expect(tables).not.toContain("ok_table");

    db.close();
  });
});
