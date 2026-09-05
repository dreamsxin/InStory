import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTurnResponse } from "@instory/shared";

vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("next/headers must not be used in the browser");
  }
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Serves the given chunks as a streaming response body. */
function respondWithChunks(chunks: string[], status = 200): void {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  fetchMock.mockResolvedValue(new Response(body, { status }));
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const completePayload = {
  turn: { id: "turn_1", narration: "你醒来时，窗外正落着细雨。" },
  state: { turnCount: 1 },
  timelineNode: null,
  quota: { remainingTurnsToday: 19 }
} as unknown as CreateTurnResponse;

async function runStreamTurn(): Promise<{ result: CreateTurnResponse; deltas: string[] }> {
  const { streamTurn } = await import("./api.js");
  const deltas: string[] = [];
  const result = await streamTurn(
    { sessionId: "sess_1", content: "继续阅读", inputType: "read_continue" },
    (delta) => deltas.push(delta)
  );
  return { result, deltas };
}

describe("streamTurn", () => {
  it("reports deltas in order and resolves with the completion payload", async () => {
    respondWithChunks([
      sseEvent("narration_delta", { text: "你醒来时，" }),
      sseEvent("narration_delta", { text: "窗外正落着细雨。" }),
      sseEvent("complete", completePayload)
    ]);

    const { result, deltas } = await runStreamTurn();

    expect(deltas).toEqual(["你醒来时，", "窗外正落着细雨。"]);
    expect(deltas.join("")).toBe(result.turn.narration);
    expect(result.quota.remainingTurnsToday).toBe(19);
  });

  it("buffers an event split across chunks", async () => {
    const event = sseEvent("narration_delta", { text: "雨夜" });
    respondWithChunks([event.slice(0, 12), event.slice(12), sseEvent("complete", completePayload)]);

    const { deltas } = await runStreamTurn();

    expect(deltas).toEqual(["雨夜"]);
  });

  it("handles several events arriving in one chunk", async () => {
    respondWithChunks([
      sseEvent("narration_delta", { text: "一" }) +
        sseEvent("narration_delta", { text: "二" }) +
        sseEvent("complete", completePayload)
    ]);

    const { deltas } = await runStreamTurn();

    expect(deltas).toEqual(["一", "二"]);
  });

  it("rejects with the server's message on an error event", async () => {
    respondWithChunks([sseEvent("narration_delta", { text: "开头" }), sseEvent("error", { error: "模型超时" })]);

    await expect(runStreamTurn()).rejects.toThrow("模型超时");
  });

  it("rejects when the stream ends without a completion", async () => {
    respondWithChunks([sseEvent("narration_delta", { text: "半句" })]);

    await expect(runStreamTurn()).rejects.toThrow("生成中断");
  });

  it("signals that the provider cannot stream so the caller can fall back", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "当前模型不支持流式生成" }), {
        status: 501,
        headers: { "content-type": "application/json" }
      })
    );

    const { streamTurn, StreamingUnsupportedError } = await import("./api.js");

    await expect(
      streamTurn({ sessionId: "sess_1", content: "继续阅读", inputType: "read_continue" }, () => {})
    ).rejects.toBeInstanceOf(StreamingUnsupportedError);
  });

  it("signals an expired session separately, so it is not retried as a fallback", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

    const { streamTurn, UnauthenticatedError } = await import("./api.js");

    await expect(
      streamTurn({ sessionId: "sess_1", content: "继续阅读", inputType: "read_continue" }, () => {})
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("signals an exhausted quota separately, so it is not retried as a fallback", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "今日推进次数已用完，请明天再来。" }), {
        status: 429,
        headers: { "content-type": "application/json" }
      })
    );

    const { streamTurn, QuotaExceededError } = await import("./api.js");

    const attempt = streamTurn(
      { sessionId: "sess_1", content: "继续阅读", inputType: "read_continue" },
      () => {}
    );

    await expect(attempt).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(attempt).rejects.toThrow("今日推进次数已用完");
  });

  it("passes the abort signal through so a generation can be stopped", async () => {
    respondWithChunks([sseEvent("complete", completePayload)]);
    const controller = new AbortController();

    const { streamTurn } = await import("./api.js");
    await streamTurn(
      { sessionId: "sess_1", content: "继续阅读", inputType: "read_continue", signal: controller.signal },
      () => {}
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("posts to the streaming endpoint with the turn payload", async () => {
    respondWithChunks([sseEvent("complete", completePayload)]);

    await runStreamTurn();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/sessions/sess_1/turns/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      inputType: "read_continue",
      content: "继续阅读",
      choiceId: null
    });
  });
});
