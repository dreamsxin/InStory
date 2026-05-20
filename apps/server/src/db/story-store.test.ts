import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeed } from "../data/story-catalog.js";
import { AppDatabase } from "./app-database.js";
import { StoryStore } from "./story-store.js";

describe("StoryStore", () => {
  it("seeds and reads story configuration from SQLite", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-story-store-"));
    const database = new AppDatabase(join(dir, "story.sqlite"));
    const store = new StoryStore(database);

    try {
      store.seedIfEmpty(loadSeed());

      expect(store.countStories()).toBe(1);
      expect(store.listStories()[0]?.id).toBe("rain-mansion");

      const detail = store.findStory("rain-mansion");
      expect(detail?.world.locations).toHaveLength(3);
      expect(detail?.characters).toHaveLength(2);
      expect(detail?.anchors).toHaveLength(4);
      expect(store.findCharacter("lu_qinghe")?.name).toBe("陆清河");
      expect(store.findStory("missing")).toBeNull();
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not duplicate seed rows when called repeatedly", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-story-store-"));
    const database = new AppDatabase(join(dir, "story.sqlite"));
    const store = new StoryStore(database);

    try {
      const seed = loadSeed();
      store.seedIfEmpty(seed);
      store.seedIfEmpty(seed);

      expect(store.countStories()).toBe(1);
      expect(store.findStory("rain-mansion")?.characters).toHaveLength(2);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
