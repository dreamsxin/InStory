import { createLLMProvider, type LLMProvider } from "@instory/ai-orchestrator";
import { narrativeResultSchema, type StorySession } from "@instory/shared";
import { createInitialState } from "@instory/story-engine";
import type {
  ModelProviderName,
  ModelConfigStore,
  PublicModelConfig,
  StoredModelConfig,
  UpdateModelConfigInput
} from "./db/model-config-store.js";

export class ModelRuntime {
  private readonly store: ModelConfigStore;
  private provider: LLMProvider;
  private config: StoredModelConfig;

  constructor(store: ModelConfigStore, initialConfig: StoredModelConfig) {
    this.store = store;
    this.config = store.get() ?? initialConfig;
    this.provider = this.createProvider(this.config);

    if (!store.get()) {
      this.store.save(this.config);
    }
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getPublicConfig(): PublicModelConfig {
    return toPublicConfig(this.config);
  }

  update(input: UpdateModelConfigInput): PublicModelConfig {
    const nextConfig = mergeConfig(this.config, input);
    const nextProvider = this.createProvider(nextConfig);

    this.config = nextConfig;
    this.provider = nextProvider;
    this.store.save(nextConfig);

    return this.getPublicConfig();
  }

  async verify(): Promise<ModelVerificationResult> {
    const startedAt = Date.now();
    const result = await this.provider.generateNarrative({
      session: createVerificationSession(),
      userInput: "我压低声音问陆清河：外面是谁？"
    });
    const parsed = narrativeResultSchema.safeParse(result);

    if (!parsed.success) {
      throw new Error(`Model output failed schema validation: ${parsed.error.message}`);
    }

    return {
      ok: true,
      provider: this.config.provider,
      model: this.config.model ?? null,
      latencyMs: Date.now() - startedAt,
      narrationLength: result.narration.length,
      choices: result.choices.length,
      memoryEvents: result.memoryEvents.length,
      checkedAt: new Date().toISOString()
    };
  }

  private createProvider(config: StoredModelConfig): LLMProvider {
    return createLLMProvider({
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model
    });
  }
}

export interface ModelVerificationResult {
  ok: true;
  provider: ModelProviderName;
  model: string | null;
  latencyMs: number;
  narrationLength: number;
  choices: number;
  memoryEvents: number;
  checkedAt: string;
}

export function createInitialModelConfig(env: NodeJS.ProcessEnv): StoredModelConfig {
  const provider: ModelProviderName = env.LLM_PROVIDER === "openai-compatible" ? "openai-compatible" : "mock";

  return {
    provider,
    baseUrl: env.LLM_BASE_URL || undefined,
    model: env.LLM_MODEL || undefined,
    apiKey: env.LLM_API_KEY || undefined,
    updatedAt: new Date().toISOString()
  };
}

function mergeConfig(current: StoredModelConfig, input: UpdateModelConfigInput): StoredModelConfig {
  const provider = input.provider;
  const apiKey = input.clearApiKey ? undefined : input.apiKey?.trim() || current.apiKey;

  return {
    provider,
    baseUrl: normalizeOptional(input.baseUrl),
    model: normalizeOptional(input.model),
    apiKey,
    updatedAt: new Date().toISOString()
  };
}

function normalizeOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toPublicConfig(config: StoredModelConfig): PublicModelConfig {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl ?? null,
    model: config.model ?? null,
    apiKeyConfigured: Boolean(config.apiKey),
    updatedAt: config.updatedAt
  };
}

function createVerificationSession(): StorySession {
  const state = createInitialState();

  return {
    id: "verify_session",
    storyId: "rain-mansion",
    readerRole: {
      mode: "existing_character",
      characterId: "lu_qinghe",
      name: "陆清河",
      description: "旧宅管事"
    },
    state,
    turns: [
      {
        id: "turn_0",
        sessionId: "verify_session",
        inputType: "free_text",
        input: "进入故事",
        narration: "你醒来时，窗外正落着细雨。门外有人停下脚步。",
        dialogues: [
          {
            speaker: "陆清河",
            text: "醒了就别出声。今晚，这座宅子不认生人。"
          }
        ],
        choices: [
          {
            id: "opening_c1",
            text: "询问自己为何在这里",
            risk: "medium"
          }
        ],
        stateSnapshot: state,
        createdAt: "2026-05-20T00:00:00.000Z"
      }
    ],
    timeline: [
      {
        id: "node_0",
        sessionId: "verify_session",
        turnId: "turn_0",
        title: "雨夜醒来",
        summary: "你在雨夜旧宅醒来，陆清河提醒你不要出声。",
        stateSnapshot: state,
        createdAt: "2026-05-20T00:00:00.000Z"
      }
    ],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z"
  };
}
