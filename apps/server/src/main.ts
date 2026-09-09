import { join } from "node:path";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { bootstrapDemoData, DEMO_ACCOUNTS, DEMO_PASSWORD_FALLBACK } from "./data/demo-bootstrap.js";
import { AppDatabase } from "./db/app-database.js";
import { AdminActionStore } from "./db/admin-action-store.js";
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
 * TRUST_PROXY to the trusted proxy address or CIDR list.
 *
 * A hop count is deliberately not accepted any more. fastify 5.12 dropped it (the
 * advisory GHSA-3m5p-2c4r-xxw2 was precisely about X-Forwarded-* spoofing under
 * hop-count trust), and a number here would now be a silently wrong configuration.
 * A refused value falls back to "trust nothing", which over-limits rather than
 * trusting a header the client writes.
 */
function readTrustProxy(value: string | undefined): boolean | string[] {
  if (!value) {
    return false;
  }

  const addresses = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (addresses.every((entry) => /^\d+$/.test(entry))) {
    console.warn(
      `TRUST_PROXY=${value} 被忽略：不再支持"信任 N 层代理"，请改成代理的地址或 CIDR（例如 172.16.0.0/12）。`
    );
    return false;
  }

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


/**
 * Demo data is on by default for a local install and off by default in production.
 *
 * A fresh install with nothing in it cannot be judged: there is no story to open, and
 * no way into the console without hand-rolling an account. Accounts whose password is
 * printed in the README are the right trade for that on a laptop and completely wrong
 * on a deployed box, so production has to ask for them, and has to bring its own
 * password when it does.
 */
function readSeedDemoData(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") {
    return !isProduction;
  }
  return raw !== "false" && raw !== "0";
}

const seedDemoData = readSeedDemoData(process.env.SEED_DEMO_DATA);
const demoPassword = process.env.DEMO_PASSWORD || DEMO_PASSWORD_FALLBACK;

if (seedDemoData && isProduction && !process.env.DEMO_PASSWORD) {
  throw new Error(
    "SEED_DEMO_DATA 在生产环境开启时必须同时设置 DEMO_PASSWORD：否则会创建一组密码写在文档里的账号。"
  );
}

const database = new AppDatabase(process.env.SQLITE_DATABASE_PATH ?? defaultDatabasePath);
const modelRuntime = new ModelRuntime(new ModelConfigStore(database), createInitialModelConfig(process.env));
const sessionStore = new SessionStore(database);
const readerProfileStore = new ReaderProfileStore(database);
const storyCatalog = new StoryCatalog(database);
const userStore = new UserStore(database);
const usageStore = new UsageStore(database);
const moderationStore = new ModerationStore(database);
const adminActionStore = new AdminActionStore(database);
const app = await buildApp({
  sessionStore,
  readerProfileStore,
  storyCatalog,
  userStore,
  usageStore,
  moderationStore,
  adminActionStore,
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
  app.log.warn("ADMIN_TOKEN 未设置：/api/admin 只接受来自本机（loopback）的请求，其他来源一律 401。");
}


if (seedDemoData) {
  const demo = bootstrapDemoData({ userStore, storyCatalog, readerProfileStore, password: demoPassword });

  if (demo.createdAccounts.length > 0) {
    // Logged once, on the run that created them: an operator who cannot find the
    // credentials will reach for the database instead, and the whole point of these
    // accounts is that nobody has to.
    app.log.info(
      { accounts: demo.createdAccounts, stories: demo.createdStories },
      demoPassword === DEMO_PASSWORD_FALLBACK
        ? `已创建示例账号，密码 ${DEMO_PASSWORD_FALLBACK}（用 DEMO_PASSWORD 覆盖；对外部署前请删除或改掉这些账号）`
        : "已创建示例账号，密码取自 DEMO_PASSWORD"
    );
  }
} else {
  app.log.info(
    { accounts: DEMO_ACCOUNTS.map((account) => account.email) },
    "SEED_DEMO_DATA 关闭：不创建示例账号与示例故事"
  );
}

const port = Number(process.env.PORT ?? 4000);

/**
 * Local development binds loopback only. The old default was 0.0.0.0 everywhere,
 * which put a dev server - including a console with no ADMIN_TOKEN behind it - on
 * every interface of the machine, café Wi-Fi included. A container needs 0.0.0.0
 * to be reachable at all, so production keeps it; anything else can say so with
 * HOST explicitly.
 */
const host = process.env.HOST ?? (isProduction ? "0.0.0.0" : "127.0.0.1");


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
