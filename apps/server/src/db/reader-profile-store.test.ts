import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "./app-database.js";
import { ReaderProfileStore } from "./reader-profile-store.js";

describe("ReaderProfileStore", () => {
  it("creates and lists reader role profiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-reader-profile-"));
    const database = new AppDatabase(join(dir, "profiles.sqlite"));
    const store = new ReaderProfileStore(database);

    try {
      const profile = store.create({
        ownerId: "local-reader",
        visibility: "private",
        name: "林向晚",
        gender: "女",
        personality: "冷静、好奇、习惯先观察再行动。",
        avatarUrl: "https://example.com/avatar.png",
        description: "被卷入旧宅谜案的现代读者。"
      });

      expect(profile.id).toMatch(/^profile_/);
      expect(store.findById(profile.id)).toMatchObject({
        name: "林向晚",
        ownerId: "local-reader",
        visibility: "private"
      });
      expect(store.listByOwner("local-reader")).toHaveLength(1);
      expect(store.listByOwner("other-reader")).toHaveLength(0);

      const updated = store.update(profile.id, "local-reader", {
        name: "林向晚修订",
        gender: null,
        visibility: "public",
        personality: "冷静、果断。",
        avatarUrl: null,
        description: "重新设定后的入戏角色。"
      });
      expect(updated).toMatchObject({
        id: profile.id,
        visibility: "public",
        name: "林向晚修订",
        gender: null,
        avatarUrl: null
      });
      expect(store.update(profile.id, "other-reader", {
        name: "越权",
        gender: null,
        visibility: "public",
        personality: "越权",
        avatarUrl: null,
        description: "越权"
      })).toBeNull();
      expect(store.delete(profile.id, "other-reader")).toBe(false);
      expect(store.delete(profile.id, "local-reader")).toBe(true);
      expect(store.findById(profile.id)).toBeNull();
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
