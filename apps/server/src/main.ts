import { join } from "node:path";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { AppDatabase } from "./db/app-database.js";
import { ModelConfigStore } from "./db/model-config-store.js";
import { ReaderProfileStore } from "./db/reader-profile-store.js";
import { SessionStore } from "./db/session-store.js";
import { UserStore } from "./db/user-store.js";
import { readPricingFromEnv, UsageStore } from "./db/usage-store.js";
import { ModerationStore } from "./db/moderation-store.js";
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

/**
 * Per-address rate limits are only meaningful if the address is real. Behind a
 * proxy every request arrives from the proxy, so the limiter would either lock all
 * readers out together or (worse) let one reader exhaust everyone's budget. Set
 * TRUST_PROXY to the number of proxy hops, or to a trusted address/CIDR list.
 * Leaving it unset is the safe default: X-Forwarded-For is client-controlled.
 */
function readTrustProxy(value: string | undefined): boolean | number | string[] {
  if (!value) {
    return false;
  }

  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) {
    return hops;
  }

  const addresses = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return addresses.length > 0 ? addresses : false;
}

/**
 * Abuse limits are tunable because the right number depends on the deployment: an
 * end-to-end suite hammers one address on purpose, and a shared-egress corporate
 * network looks like one address too. Omit to keep the built-in defaults.
 */
function readLimit(raw: string | undefined, windowMs: number) {
  const limit = Number(raw);
  return Number.isFinite(limit) && limit > 0 ? { limit: Math.floor(limit), windowMs } : undefined;
}

/**
 * A quota of NaN compares false against every limit, which silently turns the daily
 * budget off - the one failure mode nobody notices until the bill arrives. A
 * non-numeric value falls back to the default instead.
 */
function readDailyTurnQuota(raw: string | undefined): number {
  const quota = Number(raw);
  return Number.isFinite(quota) && quota >= 0 ? Math.floor(quota) : 20;
}

const abuseLimits = {
  authAttempts: readLimit(process.env.AUTH_ATTEMPTS_PER_MINUTE, 60_000),
  loginFailuresPerAccount: readLimit(process.env.LOGIN_FAILURES_PER_ACCOUNT, 15 * 60_000),
  generationBurst: readLimit(process.env.GENERATION_BURST_PER_MINUTE, 60_000)
};

/**
 * The console is gated on the account's role, so an operator needs a way to give
 * themselves that role. Listing the address here is that way: it applies on
 * register and on every sign-in, which covers both a fresh install and an account
 * that already exists.
 */
function readAdminEmails(raw: string | undefined): string[] | undefined {
  const emails = (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return emails.length > 0 ? emails : undefined;
}


const database = new AppDatabase(process.env.SQLITE_DATABASE_PATH ?? defaultDatabasePath);
const modelRuntime = new ModelRuntime(new ModelConfigStore(database), createInitialModelConfig(process.env));
const sessionStore = new SessionStore(database);
const readerProfileStore = new ReaderProfileStore(database);
const storyCatalog = new StoryCatalog(database);
const userStore = new UserStore(database);
const usageStore = new UsageStore(database);
const moderationStore = new ModerationStore(database);
const app = await buildApp({
  sessionStore,
  readerProfileStore,
  storyCatalog,
  userStore,
  usageStore,
  moderationStore,
  modelRuntime,
  adminToken,
  adminEmails: readAdminEmails(process.env.ADMIN_EMAILS),
  dailyTurnQuota: readDailyTurnQuota(process.env.DAILY_TURN_QUOTA),
  pricing: readPricingFromEnv(process.env),
  sessionTurnWindow: Number(process.env.SESSION_TURN_WINDOW || 0) || undefined,
  abuseLimits,
  trustProxy: readTrustProxy(process.env.TRUST_PROXY),
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
