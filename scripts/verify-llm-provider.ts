import { createLLMProvider } from "@instory/ai-orchestrator";
import { narrativeResultSchema, type StorySession } from "@instory/shared";
import { createInitialState } from "@instory/story-engine";

const providerName = process.env.LLM_PROVIDER === "openai-compatible" ? "openai-compatible" : "mock";

if (providerName === "openai-compatible") {
  const missing = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables for real LLM verification: ${missing.join(", ")}`);
    process.exit(1);
  }
}

const provider = createLLMProvider({
  provider: providerName,
  baseUrl: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL
});

const session: StorySession = {
  id: "verify_session",
  storyId: "rain-mansion",
  readerRole: {
    mode: "existing_character",
    characterId: "lu_qinghe",
    name: "陆清河",
    description: "旧宅管事"
  },
  state: createInitialState(),
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
      stateSnapshot: createInitialState(),
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
      stateSnapshot: createInitialState(),
      createdAt: "2026-05-20T00:00:00.000Z"
    }
  ],
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z"
};

const result = await provider.generateNarrative({
  session,
  userInput: "我压低声音问陆清河：外面是谁？"
});

const parsed = narrativeResultSchema.safeParse(result);
if (!parsed.success) {
  console.error(parsed.error.message);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      provider: providerName,
      ok: true,
      narrationLength: result.narration.length,
      choices: result.choices.length,
      memoryEvents: result.memoryEvents.length
    },
    null,
    2
  )
);
