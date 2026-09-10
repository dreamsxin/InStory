import { describe, expect, it } from "vitest";
import type { StorySummary } from "@instory/shared";
import { buildChatCompletionsUrl, buildSystemPrompt } from "@instory/ai-orchestrator";

describe("OpenAI-compatible provider helpers", () => {
  it("builds chat completions endpoint from provider base url", () => {
    expect(buildChatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(buildChatCompletionsUrl("https://api.deepseek.com/")).toBe(
      "https://api.deepseek.com/chat/completions"
    );
  });

  it("keeps a full chat completions endpoint unchanged", () => {
    expect(buildChatCompletionsUrl("https://example.com/v1/chat/completions")).toBe(
      "https://example.com/v1/chat/completions"
    );
  });

  // 共创方式 and AI 自由度 are both shown to readers on the story card. They used to
  // travel to the model only as fields inside the story summary, with nothing saying
  // what they meant, so a 剧本 story and an 即兴 story were written under identical
  // rules and the card was making a promise nothing kept.
  it("tells the model what the author's two dials mean", () => {
    const scripted = buildSystemPrompt(
      createSummary({ experienceMode: "scripted", aiFreedom: "low" })
    );
    expect(scripted).toContain("剧本模式");
    expect(scripted).toContain("不改变主线的走向和先后顺序");
    expect(scripted).toContain("不要新增人物、地点或支线");

    const improvised = buildSystemPrompt(
      createSummary({ experienceMode: "improvised", aiFreedom: "high" })
    );
    expect(improvised).toContain("即兴模式");
    expect(improvised).toContain("可以改变主线走向");
    expect(improvised).toContain("可以引入新的场景");

    const coauthored = buildSystemPrompt(createSummary());
    expect(coauthored).toContain("共创模式");
    expect(coauthored).toContain("每一个 required 锚点仍然必须发生");
  });

  it("says nothing about the dials when there is no story to read them from", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("你是 InStory 的 AI 叙事编排器");
    expect(prompt).not.toContain("AI 自由度为");
    expect(prompt).not.toContain("模式：");
  });
});

function createSummary(overrides: Partial<StorySummary> = {}): StorySummary {
  return {
    id: "lantern-ledger",
    ownerId: "user_1",
    visibility: "public",
    title: "提灯账",
    tagline: "有人替这条河记账。",
    genre: "民俗奇谈",
    coverUrl: null,
    readingTheme: "classic",
    aiFreedom: "medium",
    experienceMode: "coauthored",
    defaultSegmentLength: "standard",
    ...overrides
  };
}
