import { join } from "node:path";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { AppDatabase } from "./db/app-database.js";
import { ModelConfigStore } from "./db/model-config-store.js";
import { SessionStore } from "./db/session-store.js";
import { createInitialModelConfig, ModelRuntime } from "./model-runtime.js";

const defaultDatabasePath = join(process.env.INIT_CWD ?? process.cwd(), "data", "instory.sqlite");
const database = new AppDatabase(process.env.SQLITE_DATABASE_PATH ?? defaultDatabasePath);
const modelRuntime = new ModelRuntime(new ModelConfigStore(database), createInitialModelConfig(process.env));
const sessionStore = new SessionStore(database);
const storyCatalog = new StoryCatalog(database);
const app = await buildApp({
  sessionStore,
  storyCatalog,
  modelRuntime,
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
