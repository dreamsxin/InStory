import { describe, expect, it } from "vitest";
import { buildChatCompletionsUrl } from "@instory/ai-orchestrator";

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
});
