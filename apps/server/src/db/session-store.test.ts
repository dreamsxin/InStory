import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StorySession } from "@instory/shared";
import { AppDatabase } from "./app-database.js";
import { SessionStore } from "./session-store.js";

describe("SessionStore", () => {
  it("persists and reads story sessions from SQLite", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-session-store-"));
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const store = new SessionStore(database);

    try {
      const session = createSession({
        id: "sess_test",
        updatedAt: "2026-05-20T00:00:00.000Z"
      });

      store.save(session);

      expect(store.findById("sess_test")).toEqual(session);
      expect(store.findById("missing")).toBeNull();
      expect(store.count()).toBe(1);
      expect(store.listRecent()).toEqual([
        {
          id: "sess_test",
          storyId: "rain-mansion",
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
          turnCount: 0
        }
      ]);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updates an existing session payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-session-store-"));
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const store = new SessionStore(database);

    try {
      store.save(
        createSession({
          id: "sess_test",
          updatedAt: "2026-05-20T00:00:00.000Z"
        })
      );

      const updated = createSession({
        id: "sess_test",
        updatedAt: "2026-05-20T00:05:00.000Z",
        turnCount: 2
      });
      store.save(updated);

      expect(store.findById("sess_test")).toEqual(updated);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function createSession(overrides: { id: string; updatedAt: string; turnCount?: number }): StorySession {
  return {
    id: overrides.id,
    storyId: "rain-mansion",
    readerRole: {
      mode: "existing_character",
      characterId: "lu_qinghe",
      name: "陆清河",
      description: "旧宅管事"
    },
    state: {
      scene: "雨夜醒来",
      location: "旧宅东厢房",
      emotion: {},
      relations: {},
      items: [],
      clues: [],
      flags: {},
      turnCount: overrides.turnCount ?? 0
    },
    turns: [],
    timeline: [],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: overrides.updatedAt
  };
}
