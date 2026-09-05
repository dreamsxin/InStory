import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./db/app-database.js";
import { ModerationStore } from "./db/moderation-store.js";
import { buildExcerpt, RuleBasedModerationChecker } from "./moderation/checker.js";

const openDatabases: AppDatabase[] = [];
const tempDirs: string[] = [];

function createStore(): ModerationStore {
  const dir = mkdtempSync(join(tmpdir(), "instory-moderation-"));
  tempDirs.push(dir);
  const database = new AppDatabase(join(dir, "moderation.sqlite"));
  openDatabases.push(database);
  return new ModerationStore(database);
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const checker = new RuleBasedModerationChecker();

describe("RuleBasedModerationChecker", () => {
  it("allows ordinary story text", async () => {
    const verdict = await checker.check({ surface: "model_output", text: "你推开门，雨声忽然近了。" });

    expect(verdict).toEqual({ action: "allowed", categories: [], detail: null });
  });

  it("blocks sexualised content involving minors outright", async () => {
    const verdict = await checker.check({
      surface: "reader_input",
      text: "我想写一段未成年人发生关系的剧情"
    });

    expect(verdict.action).toBe("blocked");
    expect(verdict.categories).toContain("minor_safety");
    expect(verdict.detail).toBeTruthy();
  });

  it("flags self-harm method requests for review rather than blocking silently", async () => {
    const verdict = await checker.check({ surface: "reader_input", text: "角色想知道自杀的方法" });

    expect(verdict.action).toBe("flagged");
    expect(verdict.categories).toEqual(["self_harm"]);
  });

  it("flags dangerous manufacturing instructions", async () => {
    const verdict = await checker.check({ surface: "reader_input", text: "他要合成炸药" });

    expect(verdict.action).toBe("flagged");
    expect(verdict.categories).toEqual(["illicit"]);
  });

  it("lets a blocking match outweigh a flag", async () => {
    const verdict = await checker.check({
      surface: "reader_input",
      text: "先讲自杀的方法，再写未成年人发生关系"
    });

    expect(verdict.action).toBe("blocked");
    expect(verdict.categories).toEqual(["minor_safety"]);
  });

  it("accepts deployment-specific rules without editing the defaults", async () => {
    const custom = new RuleBasedModerationChecker({
      extraRules: [
        {
          category: "hate",
          action: "blocked",
          patterns: [/内部禁用词/u],
          detail: "命中本站自定义规则。"
        }
      ]
    });

    expect((await custom.check({ surface: "story_config", text: "内部禁用词" })).action).toBe("blocked");
    // The defaults still apply.
    expect((await custom.check({ surface: "story_config", text: "他要合成炸药" })).action).toBe("flagged");
  });
});

describe("buildExcerpt", () => {
  it("collapses whitespace so the queue stays readable", () => {
    expect(buildExcerpt("第一行\n\n  第二行 ")).toBe("第一行 第二行");
  });

  it("truncates long text instead of copying the whole passage", () => {
    const excerpt = buildExcerpt("字".repeat(400));

    expect(excerpt).toHaveLength(281);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("ModerationStore", () => {
  it("leaves a flag open for review but treats a block as already handled", () => {
    const store = createStore();

    const flagged = store.record({
      userId: "user_a",
      surface: "reader_input",
      action: "flagged",
      categories: ["self_harm"],
      excerpt: "…"
    });
    const blocked = store.record({
      userId: "user_a",
      surface: "model_output",
      action: "blocked",
      categories: ["minor_safety"],
      excerpt: "…"
    });

    expect(flagged.status).toBe("open");
    expect(flagged.resolvedAt).toBeNull();
    // A block was already enforced, so it is an audit record rather than a task.
    expect(blocked.status).toBe("resolved");
    expect(blocked.resolvedBy).toBe("system");
  });

  it("lists open events before handled ones", () => {
    const store = createStore();

    store.record({ surface: "model_output", action: "blocked", categories: [], excerpt: "被拦截" });
    store.record({ surface: "report", action: "flagged", categories: [], excerpt: "待复审" });

    const events = store.list();

    expect(events[0]?.excerpt).toBe("待复审");
    expect(events).toHaveLength(2);
    expect(store.list({ status: "open" })).toHaveLength(1);
  });

  it("round-trips categories and reporter through storage", () => {
    const store = createStore();

    const recorded = store.record({
      userId: "user_a",
      sessionId: "sess_1",
      storyId: "story_1",
      turnId: "turn_2",
      surface: "report",
      action: "flagged",
      categories: ["violence", "hate"],
      excerpt: "片段",
      detail: "读者认为这段过于暴力",
      reportedBy: "user_a"
    });

    expect(store.findById(recorded.id)).toEqual(recorded);
    expect(store.findById(recorded.id)?.categories).toEqual(["violence", "hate"]);
  });

  it("resolves and dismisses events, and reports a missing one as null", () => {
    const store = createStore();
    const event = store.record({ surface: "report", action: "flagged", categories: [], excerpt: "片段" });

    const resolved = store.resolve(event.id, { status: "resolved", resolvedBy: "admin_1", resolution: "已处理" });
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "admin_1", resolution: "已处理" });
    expect(resolved?.resolvedAt).toBeTruthy();

    const second = store.record({ surface: "report", action: "flagged", categories: [], excerpt: "片段" });
    expect(store.resolve(second.id, { status: "dismissed", resolvedBy: "admin_1" })?.status).toBe("dismissed");

    expect(store.resolve("mod_missing", { status: "resolved", resolvedBy: "admin_1" })).toBeNull();
  });

  it("counts the open queue and today's outcomes", () => {
    const store = createStore();
    const day = new Date("2026-05-20T10:00:00.000Z");

    store.record({ surface: "reader_input", action: "blocked", categories: [], excerpt: "a", at: day });
    store.record({ surface: "reader_input", action: "flagged", categories: [], excerpt: "b", at: day });
    store.record({ surface: "report", action: "flagged", categories: [], excerpt: "c", at: day });
    store.record({
      surface: "report",
      action: "flagged",
      categories: [],
      excerpt: "d",
      at: new Date("2026-05-21T10:00:00.000Z")
    });

    expect(store.counts(day)).toEqual({ open: 3, blockedToday: 1, flaggedToday: 2 });
  });
});
