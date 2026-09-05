import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./app-database.js";
import { estimateCost, UsageStore, usageDateKey } from "./usage-store.js";

const openDatabases: AppDatabase[] = [];
const tempDirs: string[] = [];

function createStore(): UsageStore {
  const dir = mkdtempSync(join(tmpdir(), "instory-usage-"));
  tempDirs.push(dir);
  const database = new AppDatabase(join(dir, "usage.sqlite"));
  openDatabases.push(database);
  return new UsageStore(database);
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const day = new Date("2026-05-20T10:00:00.000Z");
const nextDay = new Date("2026-05-21T10:00:00.000Z");

function record(
  store: UsageStore,
  overrides: Partial<Parameters<UsageStore["record"]>[0]> = {}
): void {
  store.record({
    userId: "user_a",
    sessionId: "sess_1",
    storyId: "story_1",
    provider: "openai-compatible",
    model: "test-model",
    intent: "read_segment",
    status: "success",
    usage: { promptTokens: 100, completionTokens: 300, totalTokens: 400 },
    latencyMs: 1200,
    at: day,
    ...overrides
  });
}

describe("usageDateKey", () => {
  it("keys by UTC day", () => {
    expect(usageDateKey(new Date("2026-05-20T23:59:59.000Z"))).toBe("2026-05-20");
    expect(usageDateKey(new Date("2026-05-21T00:00:01.000Z"))).toBe("2026-05-21");
  });
});

describe("UsageStore", () => {
  it("counts only the caller's successful generations for the day", () => {
    const store = createStore();

    record(store);
    record(store);
    record(store, { status: "error", usage: null });
    record(store, { userId: "user_b" });
    record(store, { at: nextDay });

    expect(store.countSuccessfulToday("user_a", day)).toBe(2);
    expect(store.countSuccessfulToday("user_b", day)).toBe(1);
    expect(store.countSuccessfulToday("user_a", nextDay)).toBe(1);
    expect(store.countSuccessfulToday("user_c", day)).toBe(0);
  });

  it("does not let a failed generation consume quota", () => {
    const store = createStore();

    record(store, { status: "error", usage: null });
    record(store, { status: "error", usage: null });

    expect(store.countSuccessfulToday("user_a", day)).toBe(0);
    // The attempts are still recorded, so a retry storm stays visible.
    expect(store.summarizeDay(day).failures).toBe(2);
  });

  it("summarises tokens, outcomes and latency for the day", () => {
    const store = createStore();

    record(store, { latencyMs: 1000 });
    record(store, { latencyMs: 3000, usage: { promptTokens: 50, completionTokens: 150, totalTokens: 200 } });
    record(store, { status: "error", usage: null, latencyMs: 2000 });
    record(store, { at: nextDay });

    const summary = store.summarizeDay(day);

    expect(summary).toMatchObject({
      date: "2026-05-20",
      generations: 3,
      successes: 2,
      failures: 1,
      promptTokens: 150,
      completionTokens: 450,
      totalTokens: 600,
      averageLatencyMs: 2000
    });
  });

  it("breaks the day down by provider and model", () => {
    const store = createStore();

    record(store, { model: "model-a" });
    record(store, { model: "model-a" });
    record(store, { model: "model-b", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    record(store, { provider: "mock", model: null });

    const byModel = store.summarizeDay(day).byModel;

    expect(byModel[0]).toMatchObject({ provider: "openai-compatible", model: "model-a", generations: 2, totalTokens: 800 });
    expect(byModel).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: "mock", model: null, generations: 1 })])
    );
  });

  it("reports an empty day without failing", () => {
    const store = createStore();

    expect(store.summarizeDay(day)).toMatchObject({
      generations: 0,
      successes: 0,
      failures: 0,
      totalTokens: 0,
      averageLatencyMs: 0,
      byModel: []
    });
  });
});

describe("estimateCost", () => {
  it("derives cost from configured per-million prices", () => {
    const cost = estimateCost(
      { promptTokens: 1_000_000, completionTokens: 500_000 },
      { inputPerMillion: 0.4, outputPerMillion: 1.6 }
    );

    expect(cost).toBeCloseTo(0.4 + 0.8, 6);
  });

  it("returns null when no price is configured, rather than a misleading zero", () => {
    expect(
      estimateCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, { inputPerMillion: 0, outputPerMillion: 0 })
    ).toBeNull();
  });

  it("still prices output when only the output rate is known", () => {
    expect(
      estimateCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, { inputPerMillion: 0, outputPerMillion: 2 })
    ).toBeCloseTo(2, 6);
  });
});
