import { join } from "node:path";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { AppDatabase } from "./db/app-database.js";
import { ModelConfigStore } from "./db/model-config-store.js";
import { ReaderProfileStore } from "./db/reader-profile-store.js";
import { SessionStore } from "./db/session-store.js";
import { UserStore } from "./db/user-store.js";
import { readPricingFromEnv, UsageStore } from "./db/usage-store.js";
import { createInitialModelConfig, ModelRuntime } from "./model-runtime.js";

const isProduction = process.env.NODE_ENV === "production";
const adminToken = process.env.ADMIN_TOKEN;

// Without a token every /api/admin route is unauthenticated (see the preHandler
// hook in app.ts), which is acceptable for local development but must never
// reach a deployed environment.
if (isProduction) {
  if (!adminToken) {
    throw new Error("ADMIN_TOKEN 未设置：生产环境下管理接口将完全无鉴权，拒绝启动。");
  }
  if (adminToken === "dev-admin-token" || adminToken.length < 32) {
    throw new Error("ADMIN_TOKEN 过弱：生产环境请使用至少 32 位的随机值，且不得沿用 .env.example 中的示例值。");
  }
}

const defaultDatabasePath = join(process.env.INIT_CWD ?? process.cwd(), "data", "instory.sqlite");
const database = new AppDatabase(process.env.SQLITE_DATABASE_PATH ?? defaultDatabasePath);
const modelRuntime = new ModelRuntime(new ModelConfigStore(database), createInitialModelConfig(process.env));
const sessionStore = new SessionStore(database);
const readerProfileStore = new ReaderProfileStore(database);
const storyCatalog = new StoryCatalog(database);
const userStore = new UserStore(database);
const usageStore = new UsageStore(database);
const app = await buildApp({
  sessionStore,
  readerProfileStore,
  storyCatalog,
  userStore,
  usageStore,
  modelRuntime,
  adminToken,
  dailyTurnQuota: Number(process.env.DAILY_TURN_QUOTA || 20),
  pricing: readPricingFromEnv(process.env),
  // Sign-in is not wired into the web client yet, so local development still falls
  // back to the seeded legacy reader. Production always requires a real session.
  allowLegacyAnonymousUser: !isProduction
});

if (database.appliedMigrations.length > 0) {
  app.log.info({ migrations: database.appliedMigrations }, "applied pending database migrations");
}

if (!adminToken) {
  app.log.warn("ADMIN_TOKEN 未设置：/api/admin 当前无鉴权，仅供本地开发使用。");
}

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
