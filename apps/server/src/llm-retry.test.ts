import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateNarrativeInput } from "@instory/ai-orchestrator";
import { LlmRequestError, OpenAICompatibleNarrativeProvider } from "@instory/ai-orchestrator";
import type { StorySession, WorldState } from "@instory/shared";

const fetchMock = vi.fn();
const sleeps: number[] = [];

beforeEach(() => {
  fetchMock.mockReset();
  sleeps.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createProvider(overrides: { maxAttempts?: number } = {}): OpenAICompatibleNarrativeProvider {
  return new OpenAICompatibleNarrativeProvider({
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: "test-model",
    maxAttempts: overrides.maxAttempts ?? 3,
    retryBaseDelayMs: 100,
    // Records the backoff instead of waiting it out.
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });
}

function createState(): WorldState {
  return {
    scene: "开场",
    location: "起点",
    emotion: {},
    relations: {},
    items: [],
    clues: [],
    flags: {},
    turnCount: 0
  };
}

function createInput(): GenerateNarrativeInput {
  const session: StorySession = {
    id: "sess_1",
    storyId: "story_1",
    readerRole: { mode: "custom_role", name: "读者", description: "测试读者" },
    state: createState(),
    turns: [],
    timeline: [],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z"
  };

  return { session, userInput: "继续阅读", intent: "read_segment" };
}

const validNarrative = {
  narration: "你醒来时，窗外正落着细雨。",
  dialogues: [],
  choices: [{ id: "c1", text: "继续观察", risk: "low" }],
  stateDelta: {},
  memoryEvents: []
};

/** A non-streaming chat completion carrying the given JSON content. */
function completionResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function errorResponse(status: number, body = "upstream failure"): Response {
  return new Response(body, { status });
}

/** An SSE body that delivers the given content as one delta. */
function streamResponse(content: unknown): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const payload = JSON.stringify({ choices: [{ delta: { content: JSON.stringify(content) } }] });
      controller.enqueue(encoder.encode(`data: ${payload}\n\ndata: [DONE]\n\n`));
      controller.close();
    }
  });

  return new Response(body, { status: 200 });
}

describe("LLM request retries", () => {
  it("retries a 500 and returns the eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(completionResponse(validNarrative));

    const { result } = await createProvider().generateNarrative(createInput());

    expect(result.narration).toBe(validNarrative.narration);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a rate limit and backs off exponentially", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(completionResponse(validNarrative));

    await createProvider({ maxAttempts: 3 }).generateNarrative(createInput());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("does not retry a bad key or an unknown model, which would only burn quota", async () => {
    for (const status of [400, 401, 403, 404]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => errorResponse(status));

      await expect(createProvider().generateNarrative(createInput())).rejects.toThrow(
        `LLM request failed: ${status}`
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("retries a reply that fails schema validation", async () => {
    fetchMock
      .mockResolvedValueOnce(completionResponse({ narration: "缺少其它字段" }))
      .mockResolvedValueOnce(completionResponse(validNarrative));

    const { result } = await createProvider().generateNarrative(createInput());

    expect(result.narration).toBe(validNarrative.narration);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transport failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(completionResponse(validNarrative));

    await createProvider().generateNarrative(createInput());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured number of attempts", async () => {
    // A fresh Response per call, because a body can only be read once.
    fetchMock.mockImplementation(async () => errorResponse(503));

    await expect(createProvider({ maxAttempts: 2 }).generateNarrative(createInput())).rejects.toBeInstanceOf(
      LlmRequestError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]);
  });

  it("honours maxAttempts of 1 by not retrying at all", async () => {
    fetchMock.mockImplementation(async () => errorResponse(500));

    await expect(createProvider({ maxAttempts: 1 }).generateNarrative(createInput())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
});

describe("LLM streaming retries", () => {
  it("retries when the failure happens before any text was emitted", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500)).mockResolvedValueOnce(streamResponse(validNarrative));

    const events = [];
    for await (const event of createProvider().streamNarrative(createInput())) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ type: "complete", result: expect.objectContaining({ narration: validNarrative.narration }) });
  });

  it("does not retry once text has already reached the reader", async () => {
    // First attempt streams a partial narration and then ends without closing the JSON.
    const encoder = new TextEncoder();
    const truncated = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const payload = JSON.stringify({ choices: [{ delta: { content: '{"narration":"已经上屏的一段' } }] });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          controller.close();
        }
      }),
      { status: 200 }
    );

    fetchMock.mockResolvedValueOnce(truncated).mockResolvedValueOnce(streamResponse(validNarrative));

    const deltas: string[] = [];
    await expect(async () => {
      for await (const event of createProvider().streamNarrative(createInput())) {
        if (event.type === "narration_delta") {
          deltas.push(event.text);
        }
      }
    }).rejects.toThrow();

    expect(deltas.join("")).toBe("已经上屏的一段");
    // A retry would have duplicated the visible text, so only one call is made.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
