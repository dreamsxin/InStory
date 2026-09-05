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

/** Emitted while a narration is still being generated. */
export interface NarrationDeltaEvent {
  type: "narration_delta";
  text: string;
}

/** Emitted once, last, when the full validated result is available. */
export interface NarrativeCompleteEvent {
  type: "complete";
  result: NarrativeResult;
}

export type NarrativeStreamEvent = NarrationDeltaEvent | NarrativeCompleteEvent;

export interface LLMProvider {
  generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult>;

  /**
   * Optional incremental variant. Callers must fall back to generateNarrative when a
   * provider does not implement it. The final event is always `complete`, carrying
   * the same validated result generateNarrative would return, so a consumer can
   * ignore the deltas and still be correct.
   */
  streamNarrative?(input: GenerateNarrativeInput): AsyncGenerator<NarrativeStreamEvent>;
}

export interface LLMProviderConfig {
  provider: "mock" | "openai-compatible";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}
