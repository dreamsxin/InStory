import { narrativeResultSchema, type NarrativeResult } from "@instory/shared";
import type { GenerateNarrativeInput, LLMProvider } from "./provider.js";

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenAICompatibleNarrativeProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response did not include message content");
    }

    const parsedJson = parseJsonObject(content);
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
    "输出只能是 JSON 对象，不要使用 Markdown，不要添加解释。",
    "JSON 字段必须包含 narration、dialogues、choices、stateDelta、memoryEvents。",
    "choices 必须包含 2 到 4 个选项，每个选项有 id、text、risk，risk 只能是 low、medium、high。",
    "stateDelta 只能描述本回合变化，不能凭空清空已有状态。",
    "玩家行为超出当前世界能力时，给出合理失败或代价，不要直接满足。"
  ].join("\n");
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
