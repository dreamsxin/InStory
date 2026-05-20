import { join } from "node:path";
import { createLLMProvider } from "@instory/ai-orchestrator";
import type { RuntimeModelConfig } from "./app.js";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { AppDatabase } from "./db/app-database.js";
import { SessionStore } from "./db/session-store.js";

const modelProvider = process.env.LLM_PROVIDER === "openai-compatible" ? "openai-compatible" : "mock";
const modelConfig: RuntimeModelConfig = {
  provider: modelProvider,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
  apiKeyConfigured: Boolean(process.env.LLM_API_KEY)
};
const provider = createLLMProvider({
  ...modelConfig,
  apiKey: process.env.LLM_API_KEY
});
const defaultDatabasePath = join(process.env.INIT_CWD ?? process.cwd(), "data", "instory.sqlite");
const database = new AppDatabase(process.env.SQLITE_DATABASE_PATH ?? defaultDatabasePath);
const sessionStore = new SessionStore(database);
const storyCatalog = new StoryCatalog(database);
const app = await buildApp({
  provider,
  sessionStore,
  storyCatalog,
  modelConfig,
  adminToken: process.env.ADMIN_TOKEN
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

process.on("SIGINT", () => {
  void app
    .close()
    .finally(() => {
      database.close();
      process.exit(0);
    });
});

process.on("SIGTERM", () => {
  void app
    .close()
    .finally(() => {
      database.close();
      process.exit(0);
    });
});

await app.listen({ port, host });
