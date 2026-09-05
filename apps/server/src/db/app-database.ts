import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

export class AppDatabase {
  readonly databasePath: string;
  readonly db: DatabaseSync;
  readonly appliedMigrations: number[];

  constructor(databasePath: string) {
    this.databasePath = resolve(databasePath);
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.appliedMigrations = runMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }
}
