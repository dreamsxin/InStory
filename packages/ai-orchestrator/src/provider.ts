import type { NarrativeResult, StoryDetail, StorySession } from "@instory/shared";

export interface GenerateNarrativeInput {
  session: StorySession;
  story?: StoryDetail;
  userInput: string;
  intent?: "reader_action" | "read_segment";
}

export interface LLMProvider {
  generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult>;
}

export interface LLMProviderConfig {
  provider: "mock" | "openai-compatible";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}
