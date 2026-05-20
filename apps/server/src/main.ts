import { join } from "node:path";
import { createLLMProvider } from "@instory/ai-orchestrator";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { SessionStore } from "./db/session-store.js";

const provider = createLLMProvider({
  provider: process.env.LLM_PROVIDER === "openai-compatible" ? "openai-compatible" : "mock",
  baseUrl: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL
});
const defaultDatabasePath = join(process.env.INIT_CWD ?? process.cwd(), "data", "instory.sqlite");
const sessionStore = new SessionStore(process.env.SQLITE_DATABASE_PATH ?? defaultDatabasePath);
const storyCatalog = new StoryCatalog();
const app = await buildApp({
  provider,
  sessionStore,
  storyCatalog
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

process.on("SIGINT", () => {
  void app.close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void app.close().finally(() => process.exit(0));
});

await app.listen({ port, host });
