import { createLLMProvider, type LLMProvider } from "@instory/ai-orchestrator";
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

  private createProvider(config: StoredModelConfig): LLMProvider {
    return createLLMProvider({
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model
    });
  }
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
