import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeed } from "../data/story-catalog.js";
import { AppDatabase } from "./app-database.js";
import { StoryStore } from "./story-store.js";
import type { CreateStoryRequest } from "@instory/shared";

describe("StoryStore", () => {
  it("seeds and reads story configuration from SQLite", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-story-store-"));
    const database = new AppDatabase(join(dir, "story.sqlite"));
    const store = new StoryStore(database);

    try {
      store.seedIfEmpty(loadSeed());

      expect(store.countStories()).toBe(1);
      expect(store.listStories()[0]?.id).toBe("rain-mansion");
      expect(store.listPublicStories()[0]?.id).toBe("rain-mansion");

      const detail = store.findStory("rain-mansion");
      expect(detail?.story.visibility).toBe("public");
      expect(detail?.world.locations).toHaveLength(5);
      expect(detail?.characters).toHaveLength(3);
      expect(detail?.anchors).toHaveLength(5);
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
      expect(store.findStory("rain-mansion")?.characters).toHaveLength(3);
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
        coverUrl: "https://example.com/cover.png",
        visibility: "public",
        aiFreedom: "high",
        experienceMode: "scripted",
        defaultSegmentLength: "long"
      });

      expect(updated).toMatchObject({
        id: "rain-mansion",
        visibility: "public",
        title: "雨夜旧宅：修订版",
        coverUrl: "https://example.com/cover.png",
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
      expect(store.findStory("rain-mansion")?.characters).toHaveLength(3);
      expect(store.updateStorySummary("missing", updated!)).toBeNull();
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not list hidden system templates in public stories", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-story-store-"));
    const database = new AppDatabase(join(dir, "story.sqlite"));
    const store = new StoryStore(database);

    try {
      store.seedIfEmpty(loadSeed());

      store.updateStorySummary("rain-mansion", {
        title: "雨夜旧宅",
        tagline: "你醒来时，门外的人已经知道了你的名字。",
        genre: "悬疑",
        coverUrl: null,
        visibility: "private",
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      });

      expect(store.findStory("rain-mansion")?.story.ownerId).toBeNull();
      expect(store.listPublicStories()).toHaveLength(0);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a minimal story with world configuration", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-story-store-"));
    const database = new AppDatabase(join(dir, "story.sqlite"));
    const store = new StoryStore(database);

    try {
      store.seedIfEmpty(loadSeed());

      const input: CreateStoryRequest = {
        id: "moon-market",
        title: "月下市集",
        tagline: "你在午夜市集里寻找被偷走的名字。",
        genre: "奇幻悬疑",
        coverUrl: "https://example.com/moon-market.png",
        visibility: "private",
        premise: "午夜之后，城市背面的市集会向失去名字的人开放。",
        openingLocationName: "市集入口",
        openingLocationDescription: "湿漉漉的石阶向下延伸，灯笼照出一排没有影子的摊位。",
        worldRules: ["不能直接说出真名", "交易必须付出记忆"],
        aiFreedom: "medium",
        experienceMode: "coauthored",
        defaultSegmentLength: "standard"
      };
      const created = store.createStory(input, [
        {
          id: "cast_lin",
          storyId: "moon-market",
          name: "林向晚",
          role: "被卷入市集的法医",
          personality: ["冷静", "敏锐"],
          goals: ["找到名字"],
          constraints: ["不会轻易相信陌生人"]
        }
      ]);

      expect(created.story).toMatchObject({
        id: "moon-market",
        ownerId: null,
        visibility: "private"
      });
      expect(created.story.coverUrl).toBe("https://example.com/moon-market.png");
      expect(created.world.locations).toHaveLength(1);
      expect(created.characters).toHaveLength(1);
      expect(created.anchors).toHaveLength(0);
      expect(store.countStories()).toBe(2);
      expect(store.findStory("moon-market")?.characters[0]?.name).toBe("林向晚");
      expect(store.findStory("moon-market")?.world.rules).toEqual(["不能直接说出真名", "交易必须付出记忆"]);
      expect(() => store.createStory(input)).toThrow("Story id already exists");
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
