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

  it("updates story summary payload without changing related configuration", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-story-store-"));
    const database = new AppDatabase(join(dir, "story.sqlite"));
    const store = new StoryStore(database);

    try {
      store.seedIfEmpty(loadSeed());

      const updated = store.updateStorySummary("rain-mansion", {
        title: "雨夜旧宅：修订版",
        tagline: "新的故事标语",
        genre: "悬疑测试",
        aiFreedom: "high",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      });

      expect(updated).toMatchObject({
        id: "rain-mansion",
        title: "雨夜旧宅：修订版",
        aiFreedom: "high",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      });
      expect(store.findStory("rain-mansion")).toMatchObject({
        story: {
          title: "雨夜旧宅：修订版",
          tagline: "新的故事标语"
        }
      });
      expect(store.findStory("rain-mansion")?.characters).toHaveLength(2);
      expect(store.updateStorySummary("missing", updated!)).toBeNull();
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
