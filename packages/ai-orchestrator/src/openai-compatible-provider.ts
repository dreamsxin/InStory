import { narrativeResultSchema, type NarrativeResult } from "@instory/shared";
import { NarrationExtractor, readUsage, SseContentReader } from "./narration-stream.js";
import type {
  GenerateNarrativeInput,
  LLMProvider,
  NarrativeGeneration,
  NarrativeStreamEvent
} from "./provider.js";

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Total attempts, including the first. Defaults to 3. */
  maxAttempts?: number;
  /** First backoff delay; each further attempt doubles it. Defaults to 500ms. */
  retryBaseDelayMs?: number;
  /** Injectable so tests do not have to wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Carries whether retrying is worth it. Config and auth problems are not retried
 * because a second identical call fails the same way and still costs money.
 */
export class LlmRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "LlmRequestError";
    this.retryable = retryable;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: unknown;
}

export class OpenAICompatibleNarrativeProvider implements LLMProvider {
  private readonly endpointUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.endpointUrl = buildChatCompletionsUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeGeneration> {
    return this.withRetries(async () => {
      const response = await this.startRequest(input, false);

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new LlmRequestError("LLM response did not include message content", true);
      }

      return {
        result: validateNarrative(content),
        usage: readUsage(payload.usage) ?? undefined
      };
    });
  }

  /**
   * Streams the upstream response and republishes the `narration` field as it
   * arrives. The structured fields are only trustworthy once the whole document has
   * been received, so the validated result is emitted last.
   *
   * Retrying is only safe before the first delta reaches the caller; once text is on
   * screen it cannot be taken back, so a later failure is surfaced as-is.
   */
  async *streamNarrative(input: GenerateNarrativeInput): AsyncGenerator<NarrativeStreamEvent> {
    for (let attempt = 1; ; attempt += 1) {
      let emitted = false;

      try {
        for await (const event of this.streamOnce(input)) {
          if (event.type === "narration_delta") {
            emitted = true;
          }
          yield event;
        }
        return;
      } catch (error) {
        if (emitted || !this.shouldRetry(error, attempt)) {
          throw error;
        }
        await this.sleep(this.backoffFor(attempt));
      }
    }
  }

  private async *streamOnce(input: GenerateNarrativeInput): AsyncGenerator<NarrativeStreamEvent> {
    const response = await this.startRequest(input, true);
    if (!response.body) {
      throw new LlmRequestError("LLM streaming response had no body", true);
    }

    const decoder = new TextDecoder();
    const sse = new SseContentReader();
    const narration = new NarrationExtractor();
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        for (const content of sse.push(decoder.decode(value, { stream: true }))) {
          const delta = narration.push(content);
          if (delta) {
            yield { type: "narration_delta", text: delta };
          }
        }
      }

      for (const content of sse.flush()) {
        const delta = narration.push(content);
        if (delta) {
          yield { type: "narration_delta", text: delta };
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!narration.raw) {
      throw new LlmRequestError("LLM streaming response did not include message content", true);
    }

    yield {
      type: "complete",
      result: validateNarrative(narration.raw),
      usage: sse.usage ?? undefined
    };
  }

  private async withRetries<T>(attemptFn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await attemptFn();
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) {
          throw error;
        }
        await this.sleep(this.backoffFor(attempt));
      }
    }
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.maxAttempts) {
      return false;
    }

    if (error instanceof LlmRequestError) {
      return error.retryable;
    }

    // Anything unclassified is most likely a transport fault, which is worth a retry.
    return true;
  }

  private backoffFor(attempt: number): number {
    return this.retryBaseDelayMs * 2 ** (attempt - 1);
  }

  private async startRequest(input: GenerateNarrativeInput, stream: boolean): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpointUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(stream ? { Accept: "text/event-stream" } : {})
        },
        body: JSON.stringify(this.buildRequestBody(input, stream))
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new LlmRequestError(`LLM request timed out after ${this.timeoutMs}ms`, true);
      }
      throw new LlmRequestError(
        `LLM request failed to reach ${this.endpointUrl}: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      // The stream is consumed after this method returns, so the timeout only
      // bounds time-to-first-byte, not the whole generation.
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new LlmRequestError(`LLM request failed: ${response.status} ${body}`, isRetryableStatus(response.status));
    }

    return response;
  }

  private buildRequestBody(input: GenerateNarrativeInput, stream: boolean): unknown {
    return {
      model: this.model,
      temperature: 0.8,
      max_tokens: estimateMaxTokens(input.lengthGuide),
      // include_usage adds a final chunk carrying token counts, which is the only way
      // to get accounting out of a streamed completion.
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: JSON.stringify({
            userInput: input.userInput,
            intent: input.intent ?? "reader_action",
            lengthGuide: input.lengthGuide ?? {
              preset: "standard",
              targetWords: 800,
              paragraphs: 6
            },
            story: input.story
              ? {
                  summary: input.story.story,
                  world: input.story.world,
                  characters: input.story.characters,
                  anchors: input.story.anchors
                }
              : null,
            readerRole: input.session.readerRole,
            currentState: input.session.state,
            recentTurns: input.session.turns.slice(-6).map((turn) => ({
              input: turn.input,
              narration: turn.narration,
              choices: turn.choices
            })),
            timeline: input.session.timeline.slice(-5).map((node) => ({
              title: node.title,
              summary: node.summary
            }))
          })
        }
      ]
    };
  }
}

export function validateNarrative(content: string): NarrativeResult {
  let parsedJson: unknown;
  try {
    parsedJson = normalizeNarrativeJson(parseJsonObject(content));
  } catch (error) {
    // A retry is worth it: with temperature above zero the next draft usually parses.
    throw new LlmRequestError(error instanceof Error ? error.message : "LLM response was not valid JSON", true);
  }

  const parsed = narrativeResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new LlmRequestError(`LLM response failed schema validation: ${parsed.error.message}`, true);
  }

  return parsed.data;
}

/**
 * 429 and 5xx are transient. 4xx otherwise means the request itself is wrong
 * (bad key, unknown model, malformed body), which no retry will fix.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function buildSystemPrompt(): string {
  return [
    "你是 InStory 的 AI 叙事编排器，负责生成受控的互动小说下一回合。",
    "必须使用第二人称“你”推进故事，保持悬疑感和明确行动压力。",
    "当 intent 是 read_segment 时，这是读者点击“继续阅读”，不是角色说话或行动；不要复述 userInput，不要写成聊天回复，要按最近剧情、故事世界和锚点自然写下一段小说。",
    "当 intent 是 reader_action 时，才把 userInput 当成读者角色的明确行动或台词处理。",
    "优先遵守 story.world、story.characters 和 story.anchors；required 锚点要逐步推进，forbidden 锚点禁止提前发生。",
    "story.characters[].relationToReader 是该演员对读者的既有态度，要体现在语气和行动上；secret 只有你知道，禁止直接写出或让演员自述，只能通过行为、回避和细节逐步透露。",
    "必须严格参考 lengthGuide。narration 应接近 lengthGuide.targetWords，并拆成 lengthGuide.paragraphs 个自然段；段落之间用换行分隔。",
    "每次 narration 应形成一个完整小说小节，有开端、推进、可观察细节、人物反应、状态变化和段末悬念；禁止只回应一句话，禁止像聊天一样短答。",
    "dialogues 只放关键对白，不能替代 narration 的正文长度。",
    "输出只能是 JSON 对象，不要使用 Markdown，不要添加解释。",
    "JSON 字段必须包含 narration、dialogues、choices、stateDelta、memoryEvents、intervention。",
    "intervention 只在这一段真的停在关键节点时给出：演员向读者发问、读者发现线索、危机逼近、路线分歧、关系变化、章节转折。对应 kind 为 npc_question、clue_found、crisis、fork、relationship_shift、turning_point。",
    "intervention.prompt 用故事口吻写一句，说明此刻可以介入什么；不要写成按钮文案，也不要催促。普通推进段落必须输出 intervention: null，不要每段都给。",
    "memoryEvents 必须是字符串数组，例如 [\"你记住了门外脚步声异常。\"]，禁止输出对象数组。",
    "choices 必须包含 2 到 4 个选项，每个选项有 id、text、risk，risk 只能是 low、medium、high。",
    "stateDelta 只能描述本回合变化，不能凭空清空已有状态。",
    "玩家行为超出当前世界能力时，给出合理失败或代价，不要直接满足。"
  ].join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function estimateMaxTokens(lengthGuide: GenerateNarrativeInput["lengthGuide"]): number {
  const targetWords = lengthGuide?.targetWords ?? 800;
  return Math.max(1200, Math.ceil(targetWords * 2.4));
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("LLM response was not valid JSON");
    }
    return JSON.parse(match[0]);
  }
}

function normalizeNarrativeJson(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.memoryEvents)) {
    return value;
  }

  return {
    ...value,
    memoryEvents: value.memoryEvents.map((event) => normalizeMemoryEvent(event))
  };
}

function normalizeMemoryEvent(event: unknown): string {
  if (typeof event === "string") {
    return event;
  }
  if (!isRecord(event)) {
    return String(event);
  }

  const fields = ["summary", "text", "event", "description", "content"];
  for (const field of fields) {
    const value = event[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return JSON.stringify(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
