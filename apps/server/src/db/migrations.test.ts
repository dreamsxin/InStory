import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./app-database.js";
import { appliedMigrationIds, migrations, runMigrations } from "./migrations.js";

const tempDirs: string[] = [];

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
    legacy.exec(migrations[0]!.up);
    legacy.close();

    const database = new AppDatabase(databasePath);

    expect(database.appliedMigrations).toEqual(migrations.map((migration) => migration.id));

    database.close();
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
