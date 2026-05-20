import { narrativeResultSchema, type NarrativeResult } from "@instory/shared";
import type { GenerateNarrativeInput, LLMProvider } from "./provider.js";

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenAICompatibleNarrativeProvider implements LLMProvider {
  private readonly endpointUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.endpointUrl = buildChatCompletionsUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpointUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.8,
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
        })
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`LLM request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response did not include message content");
    }

    const parsedJson = normalizeNarrativeJson(parseJsonObject(content));
    const parsed = narrativeResultSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(`LLM response failed schema validation: ${parsed.error.message}`);
    }

    return parsed.data;
  }
}

function buildSystemPrompt(): string {
  return [
    "你是 InStory 的 AI 叙事编排器，负责生成受控的互动小说下一回合。",
    "必须使用第二人称“你”推进故事，保持悬疑感和明确行动压力。",
    "当 intent 是 read_segment 时，这是读者点击“继续阅读”，不是角色说话或行动；不要复述 userInput，不要写成聊天回复，要按最近剧情、故事世界和锚点自然写下一段小说。",
    "当 intent 是 reader_action 时，才把 userInput 当成读者角色的明确行动或台词处理。",
    "优先遵守 story.world、story.characters 和 story.anchors；required 锚点要逐步推进，forbidden 锚点禁止提前发生。",
    "每次 narration 应形成一个完整小节，有场景推进、可观察细节和新的悬念；避免只回应一句话。",
    "输出只能是 JSON 对象，不要使用 Markdown，不要添加解释。",
    "JSON 字段必须包含 narration、dialogues、choices、stateDelta、memoryEvents。",
    "memoryEvents 必须是字符串数组，例如 [\"你记住了门外脚步声异常。\"]，禁止输出对象数组。",
    "choices 必须包含 2 到 4 个选项，每个选项有 id、text、risk，risk 只能是 low、medium、high。",
    "stateDelta 只能描述本回合变化，不能凭空清空已有状态。",
    "玩家行为超出当前世界能力时，给出合理失败或代价，不要直接满足。"
  ].join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
