import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "./app-database.js";
import { ModelConfigStore } from "./model-config-store.js";

describe("ModelConfigStore", () => {
  it("persists active model config", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-model-config-"));
    const database = new AppDatabase(join(dir, "model.sqlite"));
    const store = new ModelConfigStore(database);

    try {
      expect(store.get()).toBeNull();

      store.save({
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        model: "story-model",
        apiKey: "secret-key",
        updatedAt: "2026-05-20T00:00:00.000Z"
      });

      expect(store.get()).toEqual({
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        model: "story-model",
        apiKey: "secret-key",
        updatedAt: "2026-05-20T00:00:00.000Z"
      });
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
