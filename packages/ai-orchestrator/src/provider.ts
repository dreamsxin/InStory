import type { NarrativeResult, SegmentLengthPreset, StoryDetail, StorySession } from "@instory/shared";

export interface NarrativeLengthGuide {
  preset: SegmentLengthPreset;
  targetWords: number;
  paragraphs: number;
}

export interface GenerateNarrativeInput {
  session: StorySession;
  story?: StoryDetail;
  userInput: string;
  intent?: "reader_action" | "read_segment";
  lengthGuide?: NarrativeLengthGuide;
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
