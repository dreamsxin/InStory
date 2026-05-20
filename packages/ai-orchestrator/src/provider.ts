import type { NarrativeResult, StorySession } from "@instory/shared";

export interface GenerateNarrativeInput {
  session: StorySession;
  userInput: string;
}

export interface LLMProvider {
  generateNarrative(input: GenerateNarrativeInput): Promise<NarrativeResult>;
}
