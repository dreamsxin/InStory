import { MockNarrativeProvider } from "./mock-provider.js";
import { OpenAICompatibleNarrativeProvider } from "./openai-compatible-provider.js";
import type { LLMProvider, LLMProviderConfig } from "./provider.js";

export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  if (config.provider === "mock") {
    return new MockNarrativeProvider();
  }

  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error("OpenAI-compatible provider requires baseUrl, apiKey and model");
  }

  return new OpenAICompatibleNarrativeProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs
  });
}
