import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "./db/app-database.js";
import { ModelConfigStore } from "./db/model-config-store.js";
import { ModelRuntime } from "./model-runtime.js";

describe("ModelRuntime", () => {
  it("updates public config and keeps API key private", () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-model-runtime-"));
    const database = new AppDatabase(join(dir, "runtime.sqlite"));
    const store = new ModelConfigStore(database);

    try {
      const runtime = new ModelRuntime(store, {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      });

      const updated = runtime.update({
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        model: "story-model",
        apiKey: "secret-key"
      });

      expect(updated).toMatchObject({
        provider: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        model: "story-model",
        apiKeyConfigured: true
      });
      expect(JSON.stringify(updated)).not.toContain("secret-key");
      expect(store.get()?.apiKey).toBe("secret-key");
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("verifies the active provider output schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instory-model-runtime-"));
    const database = new AppDatabase(join(dir, "runtime.sqlite"));
    const store = new ModelConfigStore(database);

    try {
      const runtime = new ModelRuntime(store, {
        provider: "mock",
        updatedAt: "2026-05-20T00:00:00.000Z"
      });

      const result = await runtime.verify();

      expect(result).toMatchObject({
        ok: true,
        provider: "mock",
        choices: 3,
        memoryEvents: 1
      });
      expect(result.narrationLength).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
