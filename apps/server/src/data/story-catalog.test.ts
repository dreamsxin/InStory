import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db/app-database.js";
import { StoryCatalog } from "./story-catalog.js";

let catalog: StoryCatalog;
let database: AppDatabase;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-story-catalog-"));
  database = new AppDatabase(join(tempDir, "catalog.sqlite"));
  catalog = new StoryCatalog(database);
});

afterEach(() => {
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("StoryCatalog", () => {
  it("loads story seed data", () => {
    expect(catalog.listStories()).toHaveLength(1);
    expect(catalog.listStories()[0]?.id).toBe("rain-mansion");
  });

  it("returns complete story details", () => {
    const detail = catalog.findStory("rain-mansion");

    expect(detail?.story.title).toBe("雨夜旧宅");
    expect(detail?.world.locations).toHaveLength(3);
    expect(detail?.characters.map((item) => item.id)).toContain("lu_qinghe");
    expect(detail?.anchors.map((item) => item.id)).toContain("corpse_found");
  });

  it("returns null for missing stories or characters", () => {
    expect(catalog.findStory("missing")).toBeNull();
    expect(catalog.findCharacter("missing")).toBeNull();
  });
});
