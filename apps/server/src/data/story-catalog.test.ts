import { describe, expect, it } from "vitest";
import { StoryCatalog } from "./story-catalog.js";

describe("StoryCatalog", () => {
  it("loads story seed data", () => {
    const catalog = new StoryCatalog();

    expect(catalog.listStories()).toHaveLength(1);
    expect(catalog.listStories()[0]?.id).toBe("rain-mansion");
  });

  it("returns complete story details", () => {
    const catalog = new StoryCatalog();
    const detail = catalog.findStory("rain-mansion");

    expect(detail?.story.title).toBe("雨夜旧宅");
    expect(detail?.world.locations).toHaveLength(3);
    expect(detail?.characters.map((item) => item.id)).toContain("lu_qinghe");
    expect(detail?.anchors.map((item) => item.id)).toContain("corpse_found");
  });

  it("returns null for missing stories or characters", () => {
    const catalog = new StoryCatalog();

    expect(catalog.findStory("missing")).toBeNull();
    expect(catalog.findCharacter("missing")).toBeNull();
  });
});
