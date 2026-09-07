import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  createReaderProfileRequestSchema,
  createSessionRequestSchema,
  createStoryRequestSchema,
  createTurnRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  storySummarySchema,
  updateStoryCharacterRequestSchema,
  updateStoryRequestSchema
} from "@instory/shared";
import {
  applyStateDelta,
  createInitialState,
  createTimelineNode,
  deriveIntervention,
  shouldCreateTimelineNode
} from "@instory/story-engine";
import type {
  AuthUser,
  CharacterProfile,
  CreateSessionResponse,
  CreateTurnResponse,
  NarrativeResult,
  ReaderSessionListItem,
  ReaderProfile,
  SegmentLengthPreset,
  SessionTurn,
  StoryDetail,
  StorySession,
  TimelineNode,
  TurnInputType,
  TurnQuota,
  WorldState
} from "@instory/shared";
import type { StoryCatalog } from "./data/story-catalog.js";
import type { ReaderProfileStore } from "./db/reader-profile-store.js";
import type { SessionOverview, SessionStore } from "./db/session-store.js";
import { LEGACY_USER_ID, SESSION_TTL_MS, type UserRecord, type UserStore } from "./db/user-store.js";
import { estimateCost, type TokenPricing, type UsageStore } from "./db/usage-store.js";
import type { ModerationStatus, ModerationStore } from "./db/moderation-store.js";
import {
  buildExcerpt,
  RuleBasedModerationChecker,
  type ModerationChecker,
  type ModerationSurface
} from "./moderation/checker.js";
import type { ModelRuntime } from "./model-runtime.js";
import {
  DEFAULT_ABUSE_LIMITS,
  SlidingWindowRateLimiter,
  type AbuseLimitSettings,
  type RateLimitDecision
} from "./security/rate-limiter.js";

const SESSION_COOKIE_NAME = "instory_session";

const GENERATION_BURST_MESSAGE = "推进太快了，稍等一会儿再继续。";

/**
 * How much history each read materialises. A long story is otherwise a growing tax
 * on every request: the reader page shipped the whole transcript to the browser, and
 * generating one turn loaded it all just to quote the last few.
 */
const DEFAULT_TURN_WINDOW = 40;
const MAX_TURN_WINDOW = 200;
/** Enough to cover what the prompt quotes, plus room for the memory panel. */
const TIMELINE_WINDOW = 20;
/** The prompt uses the last 6 turns; a little slack costs nothing. */
const GENERATION_TURN_WINDOW = 8;
const GENERATION_READ_WINDOW = {
  recentTurns: GENERATION_TURN_WINDOW,
  recentTimelineNodes: GENERATION_TURN_WINDOW
};

function readTurnLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), MAX_TURN_WINDOW);
}

const updateModelConfigSchema = z.object({
  provider: z.enum(["mock", "openai-compatible"]),
  baseUrl: z.string().nullish(),
  model: z.string().nullish(),
  apiKey: z.string().nullish(),
  clearApiKey: z.boolean().optional()
});

const updateStorySummarySchema = storySummarySchema.omit({ id: true, ownerId: true });

const updateUserRoleSchema = z.object({ role: z.enum(["reader", "admin"]) });

/** Constant-time bearer token comparison so failures do not leak the token byte by byte. */
function matchesBearerToken(authorization: string, expectedToken: string): boolean {
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(authorization);

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Prefers an explicit bearer token, falling back to the browser session cookie. */
function readSessionToken(authorization?: string, cookieHeader?: string): string | null {
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) {
      return token;
    }
  }

  for (const part of cookieHeader?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null;
    }
  }

  return null;
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role
  };
}

function buildSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

/**
 * Sends 429 with a Retry-After header when a limiter said no. Returns true if the
 * reply has been sent, so callers can `return reply` and stop.
 */
function rejectIfLimited(
  reply: FastifyReply,
  decision: RateLimitDecision,
  message = "请求过于频繁，请稍后再试。"
): boolean {
  if (decision.allowed) {
    return false;
  }

  reply.header("retry-after", String(decision.retryAfterSeconds));
  reply.code(429).send({ error: message, retryAfterSeconds: decision.retryAfterSeconds });
  return true;
}


interface OpeningScene {
  state: WorldState;
  turn: SessionTurn;
  node: TimelineNode;
}

/**
 * Applies a generated result to the session and persists it. Shared by the plain and
 * streaming turn endpoints so both produce identical state, ids and timeline nodes.
 * The passed-in session is mutated, matching what the callers already relied on.
 */
function commitTurn(params: {
  session: StorySession;
  sessionId: string;
  inputType: TurnInputType;
  input: string;
  result: NarrativeResult;
  sessionStore: SessionStore;
  quota: TurnQuota;
}): CreateTurnResponse {
  const { session, sessionId, result } = params;
  const nextState = applyStateDelta(session.state, result.stateDelta);
  const now = new Date().toISOString();

  const turn: SessionTurn = {
    // Derived before the push, so the first generated turn follows the opening turn.
    id: `turn_${session.turns.length}`,
    sessionId,
    inputType: params.inputType,
    input: params.input,
    narration: result.narration,
    dialogues: result.dialogues,
    choices: result.choices,
    stateSnapshot: nextState,
    // The model marks a key node when it sees one; when it stays silent the state
    // it just changed is read instead, so the feature does not rest on its
    // diligence.
    intervention:
      result.intervention ??
      deriveIntervention({
        result,
        previous: session.state,
        next: nextState,
        inputType: params.inputType
      }),
    createdAt: now
  };

  session.turns.push(turn);
  session.state = nextState;
  session.updatedAt = now;

  let timelineNode: TimelineNode | null = null;
  if (shouldCreateTimelineNode(session.state, result)) {
    timelineNode = createTimelineNode({
      session,
      turnId: turn.id,
      result,
      state: nextState,
      now
    });
    session.timeline.push(timelineNode);
  }

  params.sessionStore.appendTurn(sessionId, {
    turn,
    state: nextState,
    timelineNode,
    updatedAt: now
  });

  return {
    turn,
    state: nextState,
    timelineNode,
    quota: params.quota
  };
}

/** Turn quota is counted from recorded successful generations, not from turn ids. */
function resolveQuota(usageStore: UsageStore, userId: string, dailyLimit: number): TurnQuota {
  const usedToday = usageStore.countSuccessfulToday(userId);

  return {
    dailyLimit,
    usedToday,
    remainingTurnsToday: Math.max(0, dailyLimit - usedToday)
  };
}

/**
 * Derives the opening turn from the story's own world configuration. Both session
 * creation and session reset go through here so that no story ever inherits the
 * seed story's setting, cast or dialogue.
 */
function buildOpeningScene(params: {
  story: StoryDetail;
  sessionId: string;
  mode: "start" | "restart";
  now: string;
}): OpeningScene {
  const { story, sessionId, mode, now } = params;
  const openingLocation = story.world.locations[0] ?? null;
  const locationName = openingLocation?.name ?? "未知之地";
  const host = story.characters[0] ?? null;
  const state = createInitialState({
    scene: `${story.story.title}·开场`,
    location: locationName
  });

  const narration = [openingLocation?.description, `你在${locationName}睁开眼。${story.world.premise}`]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  const turn: SessionTurn = {
    id: "turn_0",
    sessionId,
    inputType: "free_text",
    input: mode === "restart" ? "重新开始" : "进入故事",
    narration,
    dialogues: host
      ? [
          {
            speaker: host.name,
            text: `你终于来了。在${locationName}，先别急着开口。`
          }
        ]
      : [],
    choices: [
      {
        id: "opening_c1",
        text: host ? `向${host.name}询问自己为何在这里` : "弄清自己为何会在这里",
        risk: "medium"
      },
      {
        id: "opening_c2",
        text: `先观察${locationName}里的线索`,
        risk: "low"
      }
    ],
    stateSnapshot: state,
    // The opening is just the story starting; the invitation to step in belongs to
    // the passages that follow, not to the first screen.
    intervention: null,
    createdAt: now
  };

  const node: TimelineNode = {
    id: "node_0",
    sessionId,
    turnId: turn.id,
    title: state.scene,
    summary:
      mode === "restart"
        ? `你重新开始《${story.story.title}》，回到${locationName}。`
        : `你进入《${story.story.title}》，在${locationName}开始这段故事。`,
    stateSnapshot: state,
    createdAt: now
  };

  return { state, turn, node };
}

export interface BuildAppOptions {
  sessionStore: SessionStore;
  readerProfileStore: ReaderProfileStore;
  storyCatalog: StoryCatalog;
  userStore: UserStore;
  usageStore: UsageStore;
  moderationStore: ModerationStore;
  /** Defaults to the rule-based checker; swap for a real service in production. */
  moderationChecker?: ModerationChecker;
  modelRuntime: ModelRuntime;
  adminToken?: string;
  /**
   * Accounts that hold the admin role by configuration. Applied on register and on
   * every sign-in, so an operator can grant themselves the console without shell
   * access to the database - which was the only way in before.
   */
  adminEmails?: string[];
  /** Successful generations allowed per reader per UTC day. Defaults to 20. */
  dailyTurnQuota?: number;
  /** Per-million-token prices used to derive cost. Zero means "unknown". */
  pricing?: TokenPricing;
  /**
   * When true, unauthenticated requests are treated as the seeded legacy user so
   * the current web client keeps working while sign-in is being built. main.ts
   * forces this off in production, where every owner-scoped route requires a real
   * session.
   */
  allowLegacyAnonymousUser?: boolean;
  /** Overrides individual abuse limits; anything omitted keeps its default. */
  abuseLimits?: Partial<AbuseLimitSettings>;
  /**
   * Turns returned by GET /api/sessions/:id when the caller does not ask for a
   * specific count. Callers can request more, up to MAX_TURN_WINDOW.
   */
  sessionTurnWindow?: number;
  /**
   * How many reverse proxies sit in front of the API, or a trusted address/CIDR.
   * Required for per-address limits to mean anything behind a proxy, because
   * otherwise every request appears to come from the proxy. Must stay off when
   * nothing trusted is in front, since a client can forge X-Forwarded-For.
   */
  trustProxy?: boolean | number | string | string[];
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: UserRecord;
  }
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: options.trustProxy ?? false
  });

  // Spreading would let an explicit `undefined` overwrite a default, which is easy to
  // pass by accident when the overrides come from optional env vars.
  const abuseLimits: AbuseLimitSettings = {
    authAttempts: options.abuseLimits?.authAttempts ?? DEFAULT_ABUSE_LIMITS.authAttempts,
    loginFailuresPerAccount:
      options.abuseLimits?.loginFailuresPerAccount ?? DEFAULT_ABUSE_LIMITS.loginFailuresPerAccount,
    generationBurst: options.abuseLimits?.generationBurst ?? DEFAULT_ABUSE_LIMITS.generationBurst
  };
  const defaultTurnWindow = readTurnLimit(
    options.sessionTurnWindow === undefined ? undefined : String(options.sessionTurnWindow),
    DEFAULT_TURN_WINDOW
  );
  const authAttemptLimiter = new SlidingWindowRateLimiter(abuseLimits.authAttempts);
  const loginFailureLimiter = new SlidingWindowRateLimiter(abuseLimits.loginFailuresPerAccount);
  const generationLimiter = new SlidingWindowRateLimiter(abuseLimits.generationBurst);


  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.addHook("onClose", async () => {
    // Storage lifecycle is owned by the process or test harness.
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "instory-server",
    storage: "sqlite"
  }));

  // Resolves the caller's identity before any route runs. A bearer token wins over
  // the cookie so server-to-server callers can be explicit.
  app.addHook("preHandler", async (request) => {
    const token = readSessionToken(request.headers.authorization, request.headers.cookie);
    if (token) {
      const user = options.userStore.findUserBySessionToken(token);
      if (user) {
        request.authUser = user;
        return;
      }
    }

    if (options.allowLegacyAnonymousUser) {
      request.authUser = options.userStore.findById(LEGACY_USER_ID) ?? undefined;
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/admin")) {
      return;
    }

    // A signed-in admin account is sufficient; the shared token stays as a
    // bootstrap path for the very first administrator.
    if (request.authUser?.role === "admin") {
      return;
    }

    if (!options.adminToken) {
      return;
    }

    const authorization = request.headers.authorization;
    if (!authorization || !matchesBearerToken(authorization, options.adminToken)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  const secureCookies = process.env.NODE_ENV === "production";
  const moderationChecker = options.moderationChecker ?? new RuleBasedModerationChecker();

  /**
   * Runs one moderation check and records anything that is not clean. Returns the
   * verdict so the caller can decide what to do: reader input is refused with a
   * reason, while a bad generation must simply never be persisted.
   */
  async function screen(params: {
    surface: ModerationSurface;
    text: string;
    userId?: string | null;
    sessionId?: string | null;
    storyId?: string | null;
  }) {
    const verdict = await moderationChecker.check({ surface: params.surface, text: params.text });

    if (verdict.action !== "allowed") {
      options.moderationStore.record({
        userId: params.userId ?? null,
        sessionId: params.sessionId ?? null,
        storyId: params.storyId ?? null,
        surface: params.surface,
        action: verdict.action,
        categories: verdict.categories,
        excerpt: buildExcerpt(params.text),
        detail: verdict.detail
      });
    }

    return verdict;
  }

  /**
   * Keeps configured operator accounts on the admin role. Runs on register and on
   * every sign-in so a fresh install and an existing account both end up with a
   * console they can reach; the shared token stays for automation.
   */
  function promoteIfListed(user: UserRecord): UserRecord {
    const listed = options.adminEmails?.some(
      (email) => email.trim().toLowerCase() === user.email.trim().toLowerCase()
    );
    if (!listed || user.role === "admin") {
      return user;
    }
    return options.userStore.setRole(user.id, "admin") ?? user;
  }

  app.post("/api/auth/register", async (request, reply) => {
    if (rejectIfLimited(reply, authAttemptLimiter.consume(`register:${request.ip}`))) {
      return reply;
    }

    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (options.userStore.emailExists(parsed.data.email)) {
      return reply.code(409).send({ error: "该邮箱已被注册" });
    }

    const user = options.userStore.create(parsed.data);
    const session = options.userStore.issueSession(user.id);

    reply.header("set-cookie", buildSessionCookie(session.token, SESSION_TTL_MS / 1000, secureCookies));
    return reply.code(201).send({
      user: toAuthUser(promoteIfListed(user)),
      token: session.token,
      expiresAt: session.expiresAt
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (rejectIfLimited(reply, authAttemptLimiter.consume(`login:${request.ip}`))) {
      return reply;
    }

    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    // Keyed by account rather than address, so stuffing the same account from a
    // botnet still runs into the same wall.
    const accountKey = `login:${parsed.data.email.trim().toLowerCase()}`;
    const accountBudget = loginFailureLimiter.consume(accountKey);
    if (rejectIfLimited(reply, accountBudget, "尝试次数过多，该账号已被暂时锁定，请稍后再试。")) {
      return reply;
    }

    const user = options.userStore.verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      // Deliberately does not say which half was wrong.
      return reply.code(401).send({ error: "邮箱或密码不正确" });
    }

    // Only failures should count, so a successful sign-in clears the account's tally.
    loginFailureLimiter.reset(accountKey);

    const session = options.userStore.issueSession(user.id);
    reply.header("set-cookie", buildSessionCookie(session.token, SESSION_TTL_MS / 1000, secureCookies));

    return {
      user: toAuthUser(promoteIfListed(user)),
      token: session.token,
      expiresAt: session.expiresAt
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = readSessionToken(request.headers.authorization, request.headers.cookie);
    if (token) {
      options.userStore.revokeSession(token);
    }

    reply.header("set-cookie", buildSessionCookie("", 0, secureCookies));
    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "未登录" });
    }

    return { user: toAuthUser(request.authUser) };
  });

  app.get("/api/admin/status", async () => ({
    service: "instory-server",
    storage: {
      type: "sqlite",
      databasePath: options.sessionStore.databasePath
    },
    counts: {
      stories: options.storyCatalog.listStories().length,
      sessions: options.sessionStore.count()
    }
  }));

  app.get("/api/admin/models", async () => ({
    ...options.modelRuntime.getPublicConfig()
  }));

  /**
   * Hands the admin role to an account. The very first administrator is
   * bootstrapped with the shared token; after that the console itself is enough,
   * so nobody needs shell access to the database to add a colleague.
   */
  app.put("/api/admin/users/:userId/role", async (request, reply) => {
    const parsed = updateUserRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const { userId } = request.params as { userId: string };
    const user = options.userStore.setRole(userId, parsed.data.role);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    return { user: toAuthUser(user) };
  });

  app.put("/api/admin/models", async (request, reply) => {
    const parsed = updateModelConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    try {
      return options.modelRuntime.update(parsed.data);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to update model config"
      });
    }
  });

  app.post("/api/admin/models/verify", async (request, reply) => {
    try {
      return await options.modelRuntime.verify();
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: error instanceof Error ? error.message : "Model verification failed"
      });
    }
  });

  app.get("/api/admin/stories", async () => ({
    stories: options.storyCatalog.listStories().map((story) => options.storyCatalog.findStory(story.id))
  }));

  app.put("/api/admin/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const parsed = updateStorySummarySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const story = options.storyCatalog.updateStorySummary(storyId, parsed.data);
    if (!story) {
      return reply.code(404).send({ error: "Story not found" });
    }

    return { story };
  });

  app.get("/api/admin/sessions", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 20);
    return {
      sessions: options.sessionStore.listRecent(Number.isFinite(limit) ? limit : 20)
    };
  });

  app.get("/api/admin/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = options.sessionStore.findById(sessionId);

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return { session };
  });

  app.get("/api/admin/moderation/events", async (request) => {
    const query = request.query as { status?: string; limit?: string };
    const status = ["open", "resolved", "dismissed"].includes(query.status ?? "")
      ? (query.status as ModerationStatus)
      : undefined;

    return {
      events: options.moderationStore.list({ status, limit: Number(query.limit ?? 50) }),
      counts: options.moderationStore.counts()
    };
  });

  app.post("/api/admin/moderation/events/:eventId/resolve", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const body = (request.body ?? {}) as { status?: string; resolution?: string };
    const status = body.status === "dismissed" ? "dismissed" : "resolved";

    const event = options.moderationStore.resolve(eventId, {
      status,
      resolvedBy: request.authUser?.id ?? "admin-token",
      resolution: body.resolution ?? null
    });

    if (!event) {
      return reply.code(404).send({ error: "Moderation event not found" });
    }

    return { event };
  });

  /**
   * Today's generation spend. Cost is null when no per-token price is configured,
   * so the console can say "unknown" instead of showing a misleading zero.
   */
  app.get("/api/admin/usage", async () => {
    const pricing = options.pricing ?? { inputPerMillion: 0, outputPerMillion: 0 };
    const today = options.usageStore.summarizeDay();

    return {
      today,
      dailyTurnQuota: options.dailyTurnQuota ?? 20,
      pricing,
      estimatedCost: estimateCost(today, pricing)
    };
  });

  app.get("/api/stories", async () => ({
    stories: options.storyCatalog.listPublicStories()
  }));

  app.get("/api/me/stories", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    return { stories: options.storyCatalog.listStoriesByOwner(request.authUser.id) };
  });

  app.get("/api/me/sessions", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 20);
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, limit) : 20;
    const seenStoryIds = new Set<string>();
    const sessions: ReaderSessionListItem[] = [];

    // listRecentOverviews already keeps the latest session per story; seenStoryIds
    // guards the edge case of two sessions for one story sharing an updated_at.
    for (const overview of options.sessionStore.listRecentOverviews(
      request.authUser.id,
      Math.max(normalizedLimit * 2, 40)
    )) {
      if (seenStoryIds.has(overview.storyId)) {
        continue;
      }

      const sessionItem = createReaderSessionListItem(overview, options);
      if (!sessionItem) {
        continue;
      }

      seenStoryIds.add(sessionItem.storyId);
      sessions.push(sessionItem);

      if (sessions.length >= normalizedLimit) {
        break;
      }
    }

    return {
      sessions
    };
  });

  app.put("/api/me/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const parsed = updateStoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const story = options.storyCatalog.updateOwnedStory(storyId, request.authUser.id, parsed.data);
    if (!story) {
      return reply.code(404).send({ error: "Story not found" });
    }

    return { story };
  });

  /** The in-story re-set of one actor: identity, stance towards the reader, secret, goals. */
  app.put("/api/me/stories/:storyId/characters/:characterId", async (request, reply) => {
    const { storyId, characterId } = request.params as { storyId: string; characterId: string };
    const parsed = updateStoryCharacterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const character = options.storyCatalog.updateOwnedCharacter(
      storyId,
      characterId,
      request.authUser.id,
      parsed.data
    );
    if (!character) {
      return reply.code(404).send({ error: "Character not found" });
    }

    return { character };
  });

  app.delete("/api/me/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const deleted = options.storyCatalog.deleteOwnedStory(storyId, request.authUser.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Story not found" });
    }

    return reply.code(204).send();
  });

  app.post("/api/stories", async (request, reply) => {
    const parsed = createStoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const ownerId = request.authUser.id;

    try {
      const castCharacters = createCastCharacters({
        ownerId,
        storyId: parsed.data.id,
        profileIds: parsed.data.castProfileIds ?? [],
        readerProfileStore: options.readerProfileStore
      });
      const story = options.storyCatalog.createStory(parsed.data, castCharacters, ownerId);
      return reply.code(201).send({ story });
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Failed to create story"
      });
    }
  });

  app.get("/api/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const storyDetail = options.storyCatalog.findStory(storyId);

    if (!storyDetail) {
      return reply.code(404).send({ error: "Story not found" });
    }

    return storyDetail;
  });

  app.get("/api/reader/profiles", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    return { profiles: options.readerProfileStore.listByOwner(request.authUser.id) };
  });

  app.post("/api/reader/profiles", async (request, reply) => {
    const parsed = createReaderProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const profile = options.readerProfileStore.create({
      ownerId: request.authUser.id,
      ...parsed.data
    });

    return reply.code(201).send({ profile });
  });

  app.put("/api/reader/profiles/:profileId", async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    const parsed = createReaderProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const profile = options.readerProfileStore.update(profileId, request.authUser.id, parsed.data);
    if (!profile) {
      return reply.code(404).send({ error: "Profile not found" });
    }

    return { profile };
  });

  app.delete("/api/reader/profiles/:profileId", async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const deleted = options.readerProfileStore.delete(profileId, request.authUser.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Profile not found" });
    }

    return reply.code(204).send();
  });

  app.post("/api/stories/:storyId/sessions", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const storyDetail = options.storyCatalog.findStory(storyId);

    if (!storyDetail) {
      return reply.code(404).send({ error: "Story not found" });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const parsed = createSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const requestedCharacter = parsed.data.characterId
      ? options.storyCatalog.findCharacter(parsed.data.characterId)
      : null;
    const readerProfile = parsed.data.readerProfileId
      ? options.readerProfileStore.findById(parsed.data.readerProfileId)
      : null;
    const character =
      requestedCharacter?.storyId === storyId ? requestedCharacter : storyDetail.characters[0] ?? null;
    const now = new Date().toISOString();
    const sessionId = `sess_${crypto.randomUUID()}`;
    const opening = buildOpeningScene({ story: storyDetail, sessionId, mode: "start", now });
    const initialState = opening.state;

    const session: StorySession = {
      id: sessionId,
      storyId,
      readerRole: {
        mode: readerProfile ? "custom_role" : parsed.data.entryMode,
        characterId: readerProfile?.id ?? character?.id,
        name: readerProfile?.name ?? parsed.data.customRole?.name ?? character?.name ?? "陌生来客",
        description:
          readerProfile?.description ?? parsed.data.customRole?.description ?? character?.role ?? "被卷入故事的读者",
        gender: readerProfile?.gender ?? parsed.data.customRole?.gender ?? null,
        personality: readerProfile?.personality ?? parsed.data.customRole?.personality ?? null,
        avatarUrl: readerProfile?.avatarUrl ?? parsed.data.customRole?.avatarUrl ?? null
      },
      state: initialState,
      turns: [],
      timeline: [],
      createdAt: now,
      updatedAt: now
    };

    const openingTurn: SessionTurn = opening.turn;

    const openingNode: TimelineNode = opening.node;

    session.turns.push(openingTurn);
    session.timeline.push(openingNode);
    options.sessionStore.create(session, request.authUser.id);

    const response: CreateSessionResponse = {
      session,
      openingTurn
    };

    return response;
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    // A session belonging to another reader is reported as missing rather than
    // forbidden, so ids cannot be probed.
    const turnLimit = readTurnLimit((request.query as { turnLimit?: string }).turnLimit, defaultTurnWindow);
    const session = options.sessionStore.findById(sessionId, request.authUser.id, {
      recentTurns: turnLimit,
      recentTimelineNodes: TIMELINE_WINDOW
    });

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const oldestLoadedTurnId = session.turns[0]?.id ?? null;

    return {
      session,
      // Says how much of the transcript this response actually carries, so the client
      // can offer to load the rest instead of quietly showing a truncated story.
      history: {
        turnCount: options.sessionStore.countTurns(sessionId),
        loadedTurns: session.turns.length,
        oldestLoadedTurnId,
        hasMore: oldestLoadedTurnId
          ? options.sessionStore.hasTurnsBefore(sessionId, oldestLoadedTurnId)
          : false
      },
      // Carried on the read so the reader can see what is left before spending any
      // of it. It used to appear only after the first turn of the day.
      quota: resolveQuota(options.usageStore, request.authUser.id, options.dailyTurnQuota ?? 20)
    };
  });

  /**
   * Removes a reading session. Readers accumulate sessions - every trial run of a
   * story they are writing creates one - and until now nothing could remove them.
   */
  app.delete("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    // Same reasoning as the read route: someone else's session is "not found".
    if (!options.sessionStore.deleteOwned(sessionId, request.authUser.id)) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return reply.code(204).send();
  });


  /**
   * Older turns, for walking backwards through a long transcript. Cursor-based on a
   * turn id rather than an offset, so inserting a turn cannot shift the window.
   */
  app.get("/api/sessions/:sessionId/turns", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const query = request.query as { before?: string; limit?: string };
    if (!query.before) {
      return reply.code(400).send({ error: "before 参数必填" });
    }

    // Ownership first: without this the cursor could be used to read another
    // reader's transcript.
    if (!options.sessionStore.findById(sessionId, request.authUser.id, { recentTurns: 0, recentTimelineNodes: 0 })) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const limit = readTurnLimit(query.limit, defaultTurnWindow);
    const turns = options.sessionStore.listTurnsBefore(sessionId, query.before, limit);
    const oldest = turns[0]?.id ?? null;

    return {
      turns,
      hasMore: oldest ? options.sessionStore.hasTurnsBefore(sessionId, oldest) : false
    };
  });


  /**
   * Reader-initiated report. Ownership is checked first so a report cannot be used to
   * confirm that someone else's session id exists.
   */
  app.post("/api/sessions/:sessionId/report", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    // No history needed: the reported turn is fetched by id below.
    const session = options.sessionStore.findById(sessionId, request.authUser.id, {
      recentTurns: 0,
      recentTimelineNodes: 0
    });
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const body = (request.body ?? {}) as { turnId?: string; reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return reply.code(400).send({ error: "请填写举报原因。" });
    }

    // Looked up in the database rather than in a loaded window, so an old passage
    // can still be reported.
    const reportedTurn = options.sessionStore.findTurn(sessionId, body.turnId);

    const event = options.moderationStore.record({
      userId: request.authUser.id,
      sessionId,
      storyId: session.storyId,
      turnId: reportedTurn?.id ?? null,
      surface: "report",
      action: "flagged",
      categories: [],
      excerpt: buildExcerpt(reportedTurn?.narration ?? reason),
      detail: buildExcerpt(reason, 200),
      reportedBy: request.authUser.id
    });

    return reply.code(201).send({ event });
  });

  app.post("/api/sessions/:sessionId/turns", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const session = options.sessionStore.findById(sessionId, request.authUser.id, GENERATION_READ_WINDOW);

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const parsed = createTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const dailyTurnQuota = options.dailyTurnQuota ?? 20;

    // Screened before the quota check, so a refused message costs the reader nothing.
    const inputVerdict = await screen({
      surface: "reader_input",
      text: parsed.data.content,
      userId: request.authUser.id,
      sessionId,
      storyId: session.storyId
    });
    if (inputVerdict.action === "blocked") {
      return reply.code(422).send({ error: inputVerdict.detail ?? "这段输入无法提交。", moderated: true });
    }

    const quotaBefore = resolveQuota(options.usageStore, request.authUser.id, dailyTurnQuota);
    if (quotaBefore.remainingTurnsToday <= 0) {
      return reply.code(429).send({ error: "今日推进次数已用完，请明天再来。", quota: quotaBefore });
    }

    // Consumed last, so only requests that are really about to call the model pay for it.
    if (rejectIfLimited(reply, generationLimiter.consume(`turn:${request.authUser.id}`), GENERATION_BURST_MESSAGE)) {
      return reply;
    }

    const storyDetail = options.storyCatalog.findStory(session.storyId) ?? undefined;
    const intent = parsed.data.inputType === "read_continue" ? "read_segment" : "reader_action";
    const modelConfig = options.modelRuntime.getPublicConfig();
    const startedAt = Date.now();

    let generation;
    try {
      generation = await options.modelRuntime.getProvider().generateNarrative({
        session,
        story: storyDetail,
        userInput: parsed.data.content,
        intent,
        lengthGuide: createLengthGuide(storyDetail)
      });
    } catch (error) {
      options.usageStore.record({
        userId: request.authUser.id,
        sessionId,
        storyId: session.storyId,
        provider: modelConfig.provider,
        model: modelConfig.model,
        intent,
        status: "error",
        latencyMs: Date.now() - startedAt
      });
      throw error;
    }

    options.usageStore.record({
      userId: request.authUser.id,
      sessionId,
      storyId: session.storyId,
      provider: modelConfig.provider,
      model: modelConfig.model,
      intent,
      status: "success",
      usage: generation.usage,
      latencyMs: Date.now() - startedAt
    });

    // A bad generation is the system's own output, so it is discarded rather than
    // shown with a warning. The turn is not persisted and the reader can retry.
    const outputVerdict = await screen({
      surface: "model_output",
      text: generation.result.narration,
      userId: request.authUser.id,
      sessionId,
      storyId: session.storyId
    });
    if (outputVerdict.action === "blocked") {
      return reply.code(422).send({ error: "这一段生成内容未通过审核，请重新推进。", moderated: true });
    }

    return commitTurn({
      session,
      sessionId,
      inputType: parsed.data.inputType,
      input: parsed.data.content,
      result: generation.result,
      sessionStore: options.sessionStore,
      quota: resolveQuota(options.usageStore, request.authUser.id, dailyTurnQuota)
    });
  });

  /**
   * Streaming twin of the turn endpoint. The reader sees narration as it is written
   * instead of waiting for a whole generation, which can take tens of seconds.
   *
   * Events: `narration_delta` while writing, then exactly one `complete` carrying the
   * same payload the non-streaming endpoint returns, or one `error`. Nothing is
   * persisted until the model finishes, so a dropped connection leaves no half turn.
   */
  app.post("/api/sessions/:sessionId/turns/stream", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }
    const session = options.sessionStore.findById(sessionId, request.authUser.id, GENERATION_READ_WINDOW);

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const parsed = createTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const provider = options.modelRuntime.getProvider();
    if (!provider.streamNarrative) {
      return reply.code(501).send({ error: "当前模型不支持流式生成" });
    }

    const dailyTurnQuota = options.dailyTurnQuota ?? 20;

    const inputVerdict = await screen({
      surface: "reader_input",
      text: parsed.data.content,
      userId: request.authUser.id,
      sessionId,
      storyId: session.storyId
    });
    if (inputVerdict.action === "blocked") {
      return reply.code(422).send({ error: inputVerdict.detail ?? "这段输入无法提交。", moderated: true });
    }

    const quotaBefore = resolveQuota(options.usageStore, request.authUser.id, dailyTurnQuota);
    if (quotaBefore.remainingTurnsToday <= 0) {
      // Refused before opening the stream, so the client gets a normal JSON error.
      return reply.code(429).send({ error: "今日推进次数已用完，请明天再来。", quota: quotaBefore });
    }

    // Also refused before the stream opens, for the same reason.
    if (rejectIfLimited(reply, generationLimiter.consume(`turn:${request.authUser.id}`), GENERATION_BURST_MESSAGE)) {
      return reply;
    }


    const storyDetail = options.storyCatalog.findStory(session.storyId) ?? undefined;
    const intent = (parsed.data.inputType === "read_continue" ? "read_segment" : "reader_action") as
      | "read_segment"
      | "reader_action";
    const input = {
      session,
      story: storyDetail,
      userInput: parsed.data.content,
      intent,
      lengthGuide: createLengthGuide(storyDetail)
    };
    const modelConfig = options.modelRuntime.getPublicConfig();
    const startedAt = Date.now();
    const authUserId = request.authUser.id;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx and friends from buffering the whole response.
      "X-Accel-Buffering": "no"
    });

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      let completed = false;

      for await (const event of provider.streamNarrative(input)) {
        if (event.type === "narration_delta") {
          send("narration_delta", { text: event.text });
          continue;
        }

        options.usageStore.record({
          userId: authUserId,
          sessionId,
          storyId: session.storyId,
          provider: modelConfig.provider,
          model: modelConfig.model,
          intent,
          status: "success",
          usage: event.usage,
          latencyMs: Date.now() - startedAt
        });

        // Known limitation of streaming: the deltas have already reached the reader
        // by the time the full narration can be judged. Blocking here still keeps it
        // out of the transcript and the review queue records it, but a reviewer
        // should assume the reader saw it. Screening incrementally would be needed to
        // prevent exposure, which the rule-based checker cannot do reliably on
        // partial text.
        const outputVerdict = await screen({
          surface: "model_output",
          text: event.result.narration,
          userId: authUserId,
          sessionId,
          storyId: session.storyId
        });
        if (outputVerdict.action === "blocked") {
          send("error", { error: "这一段生成内容未通过审核，请重新推进。", moderated: true });
          completed = true;
          break;
        }

        const response = commitTurn({
          session,
          sessionId,
          inputType: parsed.data.inputType,
          input: parsed.data.content,
          result: event.result,
          sessionStore: options.sessionStore,
          quota: resolveQuota(options.usageStore, authUserId, dailyTurnQuota)
        });
        send("complete", response);
        completed = true;
      }

      if (!completed) {
        send("error", { error: "生成未返回完整结果" });
      }
    } catch (error) {
      request.log.error({ err: error }, "streaming turn failed");
      options.usageStore.record({
        userId: authUserId,
        sessionId,
        storyId: session.storyId,
        provider: modelConfig.provider,
        model: modelConfig.model,
        intent,
        status: "error",
        latencyMs: Date.now() - startedAt
      });
      send("error", { error: error instanceof Error ? error.message : "生成失败" });
    } finally {
      reply.raw.end();
    }

    return reply;
  });

  app.post("/api/sessions/:sessionId/rewind", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    // Deliberately unwindowed: a branch copies every turn and node up to the chosen
    // point, so this is the one read that genuinely needs the whole transcript.
    const session = options.sessionStore.findById(sessionId, request.authUser.id);
    const body = request.body as { timelineNodeId?: string };

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    if (!body.timelineNodeId) {
      return reply.code(400).send({ error: "Timeline node id is required" });
    }

    const node = session.timeline.find((item) => item.id === body.timelineNodeId);
    if (!node) {
      return reply.code(404).send({ error: "Timeline node not found" });
    }

    const now = new Date().toISOString();
    const branch: StorySession = {
      ...session,
      id: `sess_${crypto.randomUUID()}`,
      state: node.stateSnapshot,
      turns: session.turns.filter((turn) => turn.createdAt <= node.createdAt),
      timeline: session.timeline.filter((item) => item.createdAt <= node.createdAt),
      updatedAt: now
    };

    options.sessionStore.create(branch, request.authUser.id);

    return {
      session: branch
    };
  });

  app.post("/api/sessions/:sessionId/reset", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    // Only the story and the reader role carry over, so the old transcript is
    // irrelevant here.
    const session = options.sessionStore.findById(sessionId, request.authUser.id, {
      recentTurns: 0,
      recentTimelineNodes: 0
    });

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const storyDetail = options.storyCatalog.findStory(session.storyId);
    if (!storyDetail) {
      return reply.code(404).send({ error: "Story not found" });
    }

    const now = new Date().toISOString();
    const newSessionId = `sess_${crypto.randomUUID()}`;
    const opening = buildOpeningScene({
      story: storyDetail,
      sessionId: newSessionId,
      mode: "restart",
      now
    });
    const initialState = opening.state;
    const openingTurn: SessionTurn = opening.turn;
    const openingNode: TimelineNode = opening.node;
    const resetSession: StorySession = {
      id: newSessionId,
      storyId: session.storyId,
      readerRole: session.readerRole,
      state: initialState,
      turns: [openingTurn],
      timeline: [openingNode],
      createdAt: now,
      updatedAt: now
    };

    options.sessionStore.create(resetSession, request.authUser.id);

    return {
      session: resetSession
    };
  });

  return app;
}

function createCastCharacters({
  profileIds,
  ownerId,
  readerProfileStore,
  storyId
}: {
  profileIds: string[];
  ownerId: string;
  readerProfileStore: ReaderProfileStore;
  storyId: string;
}): CharacterProfile[] {
  const uniqueProfileIds = [...new Set(profileIds)];
  return uniqueProfileIds
    .map((profileId) => readerProfileStore.findById(profileId))
    .filter((profile): profile is ReaderProfile => profile !== null && profile.ownerId === ownerId)
    .map((profile) => ({
      id: `cast_${profile.id}`,
      storyId,
      name: profile.name,
      role: profile.description,
      // Left blank on purpose: the author sets these per story from the console,
      // and an invented stance or secret would be worse than none.
      relationToReader: "",
      secret: "",
      personality: splitProfileText(profile.personality),
      goals: ["参与故事互动", "根据自身设定回应读者行动"],
      constraints: splitProfileText(profile.description)
    }));
}

function createReaderSessionListItem(
  overview: SessionOverview,
  options: BuildAppOptions
): ReaderSessionListItem | null {
  const story = options.storyCatalog.findStory(overview.storyId)?.story;
  if (!story) {
    return null;
  }

  return {
    id: overview.id,
    storyId: story.id,
    storyTitle: story.title,
    story,
    readerRoleName: overview.readerRoleName,
    latestSummary: overview.latestNarration ?? "刚刚进入故事。",
    turnCount: overview.turnCount,
    createdAt: overview.createdAt,
    updatedAt: overview.updatedAt
  };
}

function createLengthGuide(storyDetail: StoryDetail | undefined) {
  const preset = storyDetail?.story.defaultSegmentLength ?? "standard";
  const guides: Record<SegmentLengthPreset, { targetWords: number; paragraphs: number }> = {
    short: {
      targetWords: 450,
      paragraphs: 4
    },
    standard: {
      targetWords: 800,
      paragraphs: 6
    },
    long: {
      targetWords: 1200,
      paragraphs: 8
    }
  };

  return {
    preset,
    ...guides[preset]
  };
}

function splitProfileText(value: string): string[] {
  return value
    .split(/[，,。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}
