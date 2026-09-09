import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminActionStore } from "./admin-action-store.js";
import { AppDatabase } from "./app-database.js";

let database: AppDatabase;
let store: AdminActionStore;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-admin-actions-"));
  database = new AppDatabase(join(tempDir, "actions.sqlite"));
  store = new AdminActionStore(database);
});

afterEach(() => {
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("AdminActionStore", () => {
  it("records what was done, to what, by whom", () => {
    const recorded = store.record({
      actorId: "user_admin",
      actorEmail: "ops@example.com",
      action: "story_takedown",
      targetType: "story",
      targetId: "rain-mansion",
      targetLabel: "雨夜旧宅",
      detail: "含未成年人相关描写",
      at: new Date("2026-05-20T10:00:00.000Z")
    });

    expect(recorded).toMatchObject({
      actorEmail: "ops@example.com",
      action: "story_takedown",
      targetType: "story",
      targetId: "rain-mansion",
      targetLabel: "雨夜旧宅",
      createdAt: "2026-05-20T10:00:00.000Z"
    });
    // The label is stored, not looked up later: a story can be renamed or deleted, and
    // a row that only held an id would stop being readable exactly when it is needed.
    expect(store.list()[0]?.targetLabel).toBe("雨夜旧宅");
  });

  it("leaves the operator blank when the call used the shared token", () => {
    store.record({ action: "revoke_sessions", targetType: "user", targetId: "user_1" });

    // ADMIN_TOKEN has no person behind it. Naming someone would be the one lie an
    // audit trail must not tell.
    expect(store.list()[0]).toMatchObject({ actorId: null, actorEmail: null, detail: null });
  });

  it("lists newest first and can answer what happened to one target", () => {
    store.record({
      action: "role_change",
      targetType: "user",
      targetId: "user_1",
      detail: "角色改为 admin",
      at: new Date("2026-05-20T10:00:00.000Z")
    });
    store.record({
      action: "revoke_sessions",
      targetType: "user",
      targetId: "user_1",
      at: new Date("2026-05-20T11:00:00.000Z")
    });
    store.record({
      action: "story_takedown",
      targetType: "story",
      targetId: "moon-market",
      at: new Date("2026-05-20T12:00:00.000Z")
    });

    expect(store.list().map((row) => row.action)).toEqual([
      "story_takedown",
      "revoke_sessions",
      "role_change"
    ]);
    expect(store.listForTarget("user", "user_1").map((row) => row.action)).toEqual([
      "revoke_sessions",
      "role_change"
    ]);
    expect(store.listForTarget("story", "no-such-story")).toEqual([]);
    // Capped rather than unbounded: the console shows a page.
    expect(store.list(1).map((row) => row.action)).toEqual(["story_takedown"]);
  });
});
