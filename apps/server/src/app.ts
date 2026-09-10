import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createReaderProfileRequestSchema,
  createSessionRequestSchema,
  createStoryRequestSchema,
  createTurnRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  storySummarySchema,
  updateStoryAnchorsRequestSchema,
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
  GenerationUsage,
  NarrativeResult,
  PublicStoryDetail,
  ReaderSessionListItem,
  ReaderProfile,
  SegmentLengthPreset,
  SessionTurn,
  StoryDetail,
  StorySession,
  StorySummary,
  TimelineNode,
  TurnInputType,
  TurnQuota,
  WorldState
} from "@instory/shared";
import type { StoryCatalog } from "./data/story-catalog.js";
import { DuplicateStoryIdError } from "./db/story-store.js";
import type { ReaderProfileStore } from "./db/reader-profile-store.js";
import type { SessionOverview, SessionStore } from "./db/session-store.js";
import { LEGACY_USER_ID, SESSION_TTL_MS, type UserRecord, type UserStore } from "./db/user-store.js";
import {
  estimateCost,
  usageDayResetsAt,
  type TokenPricing,
  type UsageStore
} from "./db/usage-store.js";
import type { ModerationStatus, ModerationStore } from "./db/moderation-store.js";
import type { AdminActionStore } from "./db/admin-action-store.js";
import {
  buildExcerpt,
  RuleBasedModerationChecker,
  type ModerationChecker,
  type ModerationSurface
} from "./moderation/checker.js";
import type { ModelRuntime } from "./model-runtime.js";
import { isLoopbackAddress } from "./security/addresses.js";

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
  /**
   * The ids of this story's plot anchors. The model's reported anchor is kept only if
   * it is one of these: an invented id would otherwise show up in the author's beat
   * counts as a node they never wrote.
   */
  anchorIds?: string[];
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
    updatedAt: now,
    anchorId:
      result.anchorId && params.anchorIds?.includes(result.anchorId) ? result.anchorId : null
  });


  return {
    turn,
    state: nextState,
    timelineNode,
    quota: params.quota
  };
}

/**
 * Who may read a story's world, cast and anchors: anyone for a public story, the
 * author for their own, and a reader who already has a session in it — hiding a
 * story afterwards should not break the reading of someone already inside it.
 */
function canReadStory(
  story: StorySummary,
  userId: string | undefined,
  sessionStore: SessionStore
): boolean {
  if (story.visibility === "public") {
    return true;
  }
  if (!userId) {
    return false;
  }
  return story.ownerId === userId || sessionStore.hasSessionForStory(userId, story.id);
}

/**
 * The story as anyone but its author may see it. The full detail carries what the
 * author wrote for the model: every actor's secret, goals and constraints, and the
 * plot anchors - including what must not happen yet and how the story can end.
 * Handing that to a reader is handing them the ending, so a non-author gets the
 * world, and actors by name and role only.
 */
function toPublicStoryDetail(detail: StoryDetail): PublicStoryDetail {
  return {
    story: detail.story,
    world: detail.world,
    characters: detail.characters.map((character) => ({
      id: character.id,
      storyId: character.storyId,
      name: character.name,
      role: character.role
    }))
  };
}


/** Turn quota is counted from recorded successful generations, not from turn ids. */
function resolveQuota(usageStore: UsageStore, userId: string, dailyLimit: number): TurnQuota {
  const usedToday = usageStore.countSuccessfulToday(userId);

  return {
    dailyLimit,
    usedToday,
    remainingTurnsToday: Math.max(0, dailyLimit - usedToday),
    resetsAt: usageDayResetsAt()
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
  /**
   * Where operator actions are written. Required rather than optional: the console can
   * hide a story and end an account's logins, and an audit trail that a deployment can
   * forget to wire up is not one.
   */
  adminActionStore: AdminActionStore;
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
  trustProxy?: boolean | string | string[];

  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: UserRecord;
    /**
     * True when the identity above is the non-production fallback rather than a
     * session the caller presented. Owner-scoped routes may treat it as a caller;
     * anything that answers "who am I" must not, or the app tells an anonymous
     * visitor they are signed in.
     */
    authUserIsFallback?: boolean;
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
      request.authUserIsFallback = request.authUser !== undefined;
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
      /**
       * No token means the console has no lock at all. That is a local-development
       * convenience, and it has to stay local: without this, a laptop dev server on
       * the default HOST=0.0.0.0 handed the whole console - usage, accounts, story
       * takedowns - to anyone on the same network.
       *
       * The raw socket address is used rather than `request.ip`, which honours
       * X-Forwarded-For under trustProxy: a header the caller writes must never be
       * able to claim loopback. A proxied request therefore never counts as local,
       * which is the safe direction to be wrong in.
       */
      if (isLoopbackAddress(request.socket.remoteAddress)) {
        return;
      }

      request.log.warn(
        { remoteAddress: request.socket.remoteAddress },
        "refused an unauthenticated /api/admin request from a non-local address; set ADMIN_TOKEN or sign in as an admin"
      );
      return reply.code(401).send({ error: "Unauthorized" });
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

    // Checked after the password, not instead of it: telling an unauthenticated caller
    // that an address exists and is suspended would answer a question they have not
    // earned. Whoever holds the password gets the real reason, because "wrong password"
    // would send them round in circles changing a password that works.
    if (user.disabledAt) {
      return reply.code(403).send({ error: "这个账号已被停用，如需恢复请联系管理员。" });
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
    // The dev fallback is not an answer to this question. Reporting it made an
    // anonymous visitor look signed in as the seeded local reader, which sent
    // /login straight back to the home page - so 退出登录 appeared to do nothing.
    if (!request.authUser || request.authUserIsFallback) {
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
   * The accounts an operator has to reason about. Read-only and deliberately thin:
   * ids, addresses, names, roles and when they signed up - no password material and
   * nothing about what anyone read. Until this existed the role endpoint below could
   * only be used by someone who already knew a user id, which meant opening the
   * database by hand.
   */
  app.get("/api/admin/users", async (request) => {
    const { limit } = request.query as { limit?: string };
    const parsed = Number(limit);
    return { users: options.userStore.listUsers(Number.isFinite(parsed) ? parsed : 50) };
  });

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

    options.adminActionStore.record({
      ...auditActor(request),
      action: "role_change",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      detail: `角色改为 ${parsed.data.role}`
    });

    return { user: toAuthUser(user) };
  });

  /**
   * Signs one account out everywhere. The store could already do it; nothing exposed
   * it, so the only way to end a stolen or abusive session was to open the database.
   *
   * Not the operator's own account: the whole point is to act on someone else, and
   * ending your own session mid-request would log you out of the page you are using -
   * the same reason the role button refuses self-demotion. 退出登录 is the way to
   * leave your own session.
   */
  app.post("/api/admin/users/:userId/revoke-sessions", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const user = options.userStore.findById(userId);

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (request.authUser?.id === userId) {
      return reply.code(400).send({ error: "这是你自己的账号，请用「退出登录」结束自己的会话。" });
    }

    const revokedSessions = options.userStore.revokeAllSessions(userId);

    options.adminActionStore.record({
      ...auditActor(request),
      action: "revoke_sessions",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      detail: `吊销 ${revokedSessions} 个登录会话`
    });

    // Logged as well as recorded: the table is the answer to "who did this", the log
    // is what an operator watching the process sees at the moment it happens.
    app.log.warn(
      { adminId: request.authUser?.id ?? "admin-token", userId, email: user.email, revokedSessions },
      "revoked all sessions for an account"
    );

    return { userId, email: user.email, revokedSessions };
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
   * Take the story off the shelf and close the event in one action.
   *
   * The queue could only change the colour of its own row: an operator who decided a
   * story was over the line had to remember its id, find it in 故事配置 and flip
   * visibility by hand - the one step that actually protects readers was the one the
   * queue did not do. Visibility, not deletion: the author's work stays theirs, it is
   * only off the public shelf, and readers already inside keep their sessions.
   */
  app.post("/api/admin/moderation/events/:eventId/takedown", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const body = (request.body ?? {}) as { resolution?: string };
    const event = options.moderationStore.findById(eventId);

    if (!event) {
      return reply.code(404).send({ error: "Moderation event not found" });
    }

    if (!event.storyId) {
      return reply.code(400).send({ error: "这条事件没有关联故事，无法下架。" });
    }

    const detail = options.storyCatalog.findStory(event.storyId);
    if (!detail) {
      return reply.code(404).send({ error: "故事不存在，可能已被作者删除。" });
    }

    const { id: _id, ownerId: _ownerId, ...summary } = detail.story;
    const story = options.storyCatalog.updateStorySummary(event.storyId, {
      ...summary,
      visibility: "private"
    });

    const note = (body.resolution ?? "").trim();
    const resolved = options.moderationStore.resolve(eventId, {
      status: "resolved",
      resolvedBy: request.authUser?.id ?? "admin-token",
      // Says what was done, not just that something was: a queue that records only
      // "resolved" cannot answer "was this story ever taken down".
      resolution: note ? `已下架《${detail.story.title}》：${note}` : `已下架《${detail.story.title}》`
    });

    options.adminActionStore.record({
      ...auditActor(request),
      action: "story_takedown",
      targetType: "story",
      targetId: event.storyId,
      targetLabel: detail.story.title,
      detail: note || null
    });

    return { event: resolved, story };
  });

  /**
   * Suspends or restores an account. Stronger than ending sessions, which only lasts
   * until the person signs in again: a suspended account cannot sign in at all, and
   * any token it still holds stops resolving.
   *
   * Suspending also revokes the sessions, because leaving them alive would mean the
   * ban takes effect whenever the cookie happens to expire - up to thirty days later.
   * Restoring does not hand them back: signing in again is the way in.
   */
  app.put("/api/admin/users/:userId/access", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = (request.body ?? {}) as { disabled?: unknown; reason?: unknown };

    if (typeof body.disabled !== "boolean") {
      return reply.code(400).send({ error: "disabled 必须是 true 或 false。" });
    }

    const existing = options.userStore.findById(userId);
    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (request.authUser?.id === userId) {
      return reply.code(400).send({ error: "这是你自己的账号，不能停用自己。" });
    }

    const user = options.userStore.setDisabled(userId, body.disabled);
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const revokedSessions = body.disabled ? options.userStore.revokeAllSessions(userId) : 0;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    options.adminActionStore.record({
      ...auditActor(request),
      action: body.disabled ? "account_ban" : "account_unban",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      detail: body.disabled
        ? [reason, `同时吊销 ${revokedSessions} 个登录会话`].filter(Boolean).join("；")
        : reason || null
    });

    app.log.warn(
      { adminId: request.authUser?.id ?? "admin-token", userId, disabled: body.disabled, revokedSessions },
      body.disabled ? "disabled an account" : "restored an account"
    );

    return { user: toAuthUser(user), disabledAt: user.disabledAt, revokedSessions };
  });

  /**
   * What operators have done lately. Read-only and append-only underneath: the point
   * of the trail is that the console cannot edit or clear it.
   */
  app.get("/api/admin/actions", async (request) => {
    const query = request.query as { limit?: string };
    return { actions: options.adminActionStore.list(Number(query.limit ?? 50)) };
  });

  /**
   * Today's generation spend. Cost is null when no per-token price is configured,
   * so the console can say "unknown" instead of showing a misleading zero.
   */
  app.get("/api/admin/usage", async () => {
    const pricing = options.pricing ?? { inputPerMillion: 0, outputPerMillion: 0 };
    const today = options.usageStore.summarizeDay();
    const titles = new Map(options.storyCatalog.listStories().map((story) => [story.id, story.title]));

    return {
      today,
      dailyTurnQuota: options.dailyTurnQuota ?? 20,
      pricing,
      estimatedCost: estimateCost(today, pricing),
      /**
       * Where the day's tokens went, per story. The title is resolved here because a
       * story id is not something an operator recognises; a deleted story keeps its
       * row with a null title, since the spend happened either way.
       */
      byStory: options.usageStore.summarizeStoriesForDay().map((story) => ({
        ...story,
        title: story.storyId ? titles.get(story.storyId) ?? null : null,
        estimatedCost: estimateCost(story, pricing)
      }))
    };
  });


  /**
   * The public shelf. Each entry carries the two figures a reader needs to judge
   * "how long is this" - how many beats the author planned, and how many words a
   * passage is written to - and neither of them exposes the outline itself.
   */
  app.get("/api/stories", async () => {
    const beats = options.storyCatalog.countPlannedBeats();

    return {
      stories: options.storyCatalog.listPublicStories().map((story) => ({
        ...story,
        plannedBeats: beats.get(story.id) ?? 0,
        segmentTargetWords: SEGMENT_LENGTH_GUIDES[story.defaultSegmentLength].targetWords
      }))
    };
  });


  /**
   * How far each public story has carried readers, for the explore shelf. Aggregates
   * only, and each story's own author is excluded, so the number means "other people
   * read this" rather than "the author opened it".
   */
  app.get("/api/stories/insights", async () => {
    const stories = options.storyCatalog.listPublicStories();

    return {
      insights: options.sessionStore.summarizeStories(
        stories.map((story) => ({ storyId: story.id, ownerId: story.ownerId }))
      )
    };
  });


  app.get("/api/me/stories", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    return { stories: options.storyCatalog.listStoriesByOwner(request.authUser.id) };
  });

  /** How far the caller's own stories have carried other readers. Aggregates only. */
  app.get("/api/me/story-insights", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const stories = options.storyCatalog.listStoriesByOwner(request.authUser.id);

    return {
      insights: options.sessionStore.summarizeStories(
        stories.map((story) => ({ storyId: story.id, ownerId: story.ownerId }))
      )
    };
  });


  /**
   * Today's budget on its own. The quota used to be readable only from inside a
   * session, so the shelf could promise "每天 20 次" while the reader had two left,
   * and they found out mid-passage. One reader, one number, no story needed.
   */
  app.get("/api/me/quota", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    return { quota: resolveQuota(options.usageStore, request.authUser.id, options.dailyTurnQuota ?? 20) };
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

      const sessionItem = createReaderSessionListItem(overview, options, request.authUser.id);

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

  /** The story's plot anchors, replaced as a whole set. */
  app.put("/api/me/stories/:storyId/anchors", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const parsed = updateStoryAnchorsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    if (!request.authUser) {
      return reply.code(401).send({ error: "请先登录" });
    }

    const anchors = options.storyCatalog.replaceOwnedAnchors(storyId, request.authUser.id, parsed.data);
    if (!anchors) {
      return reply.code(404).send({ error: "Story not found" });
    }

    return { anchors };
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
      // The one cause an author can do something about, said in words they can act
      // on. The store's own message is for a log, not for a form.
      if (error instanceof DuplicateStoryIdError) {
        return reply.code(409).send({
          error: `故事 ID「${error.storyId}」已经被占用，换一个再试。`,
          field: "id"
        });
      }
      request.log.error({ err: error }, "creating a story failed");
      return reply.code(409).send({ error: "创建故事失败，请稍后再试。" });
    }
  });

  app.get("/api/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const storyDetail = options.storyCatalog.findStory(storyId);

    // 404 rather than 403 when it is not the caller's to read: a private story
    // should not confirm that the id exists.
    if (!storyDetail || !canReadStory(storyDetail.story, request.authUser?.id, options.sessionStore)) {
      return reply.code(404).send({ error: "Story not found" });
    }

    // Only the author gets the full sheet. Everyone else - including a reader with
    // a session in it - would otherwise be handed the actors' secrets and the whole
    // plot outline, which is the story they came to be told.
    if (storyDetail.story.ownerId && storyDetail.story.ownerId === request.authUser?.id) {
      return storyDetail;
    }

    return toPublicStoryDetail(storyDetail);
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

    // Starting a story is only for a public one or the author's own. Continuing an
    // existing session goes through /api/sessions/:id, which is owner-checked, so a
    // reader who already started keeps reading even if the author hides the story.
    if (storyDetail.story.visibility !== "public" && storyDetail.story.ownerId !== request.authUser.id) {
      return reply.code(404).send({ error: "Story not found" });
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
    options.sessionStore.create(session, request.authUser.id, storyDetail.story.title);

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
      // No "come back tomorrow": the day is a UTC day, so the reader's tomorrow may
      // be hours away from the reset. The client turns quota.resetsAt into a local
      // time instead.
      return reply.code(429).send({ error: "今日推进次数已用完。", quota: quotaBefore });
    }

    // Consumed last, so only requests that are really about to call the model pay for it.
    if (rejectIfLimited(reply, generationLimiter.consume(`turn:${request.authUser.id}`), GENERATION_BURST_MESSAGE)) {
      return reply;
    }

    const storyDetail = options.storyCatalog.findStory(session.storyId) ?? undefined;
    const intent = parsed.data.inputType === "read_continue" ? "read_segment" : "reader_action";
    const modelConfig = options.modelRuntime.getPublicConfig();
    const startedAt = Date.now();
    const authorTrial = isAuthorTrial(storyDetail?.story.ownerId, request.authUser.id);

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
        isAuthorTrial: authorTrial,
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
      isAuthorTrial: authorTrial,
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
      anchorIds: storyDetail?.anchors.map((anchor) => anchor.id),
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
      // No "come back tomorrow": the day is a UTC day, so the reader's tomorrow may
      // be hours away from the reset. The client turns quota.resetsAt into a local
      // time instead.
      return reply.code(429).send({ error: "今日推进次数已用完。", quota: quotaBefore });
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
    const authorTrial = isAuthorTrial(storyDetail?.story.ownerId, authUserId);


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

    /**
     * The reader pressing 停止生成 aborts their request, and a closed socket is the
     * only word we get about it. Until this existed the server read the generation
     * to the end and committed it: the reader was told the passage was stopped, was
     * charged a turn for it, and found it in the transcript on the next visit.
     */
    let readerLeft = false;
    let streamFinished = false;
    request.raw.on("close", () => {
      // Set before the response is closed on purpose: a destroyed socket already
      // looks "ended" from the response side, so only our own flag can tell a
      // finished passage from an abandoned one.
      if (!streamFinished) {
        readerLeft = true;
      }
    });
    /**
     * Both signals matter: the event covers a clean hang-up, and the destroyed
     * response covers the case where it fired before this handler was attached.
     * `request.raw.destroyed` is deliberately not consulted - Node destroys the
     * request stream once its body has been read, so it is true on every request.
     */
    const readerGone = (): boolean => readerLeft || reply.raw.destroyed;

    let usageRecorded = false;
    const recordUsage = (status: "success" | "error", usage?: GenerationUsage): void => {
      if (usageRecorded) {
        return;
      }
      usageRecorded = true;
      options.usageStore.record({
        userId: authUserId,
        sessionId,
        storyId: session.storyId,
        provider: modelConfig.provider,
        model: modelConfig.model,
        intent,
        status,
        usage,
        isAuthorTrial: authorTrial,
        latencyMs: Date.now() - startedAt
      });

    };

    try {
      let completed = false;

      for await (const event of provider.streamNarrative(input)) {
        // Checked before every event, so a passage that finishes generating after
        // the reader left is neither charged nor written into their transcript.
        if (readerGone()) {
          break;
        }

        if (event.type === "narration_delta") {
          send("narration_delta", { text: event.text });
          continue;
        }

        recordUsage("success", event.usage);

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
          anchorIds: storyDetail?.anchors.map((anchor) => anchor.id),
          quota: resolveQuota(options.usageStore, authUserId, dailyTurnQuota)
        });

        send("complete", response);
        completed = true;
      }

      if (readerGone() && !completed) {
        // Cancelled, not failed: no turn, and no success row, so the reader keeps
        // the turn they did not get. Still recorded as an error, because the model
        // was called and may well have been billed - a silent gap in usage would
        // hide that spend.
        recordUsage("error");
      } else if (!completed) {
        send("error", { error: "生成未返回完整结果" });
      }
    } catch (error) {
      request.log.error({ err: error }, "streaming turn failed");
      recordUsage("error");
      send("error", { error: error instanceof Error ? error.message : "生成失败" });
    } finally {
      streamFinished = true;
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

    options.sessionStore.create(branch, request.authUser.id, options.sessionStore.findStoryTitle(sessionId) ?? "");

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

    options.sessionStore.create(resetSession, request.authUser.id, storyDetail.story.title);

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

/**
 * One reading progress card. A session whose story has been deleted still gets a
 * card - with `story: null` and the title recorded when it was opened - because a
 * card that quietly vanishes leaves the reader wondering what happened to their
 * reading.
 */
/**
 * Who to credit an operator action to. The development anonymous fallback is not an
 * identity - the same rule `/api/auth/me` follows - so an audit row leaves the operator
 * blank rather than naming the seeded local reader. Blank also covers ADMIN_TOKEN,
 * which is a shared credential with nobody behind it.
 */
function auditActor(request: FastifyRequest): { actorId: string | null; actorEmail: string | null } {
  if (!request.authUser || request.authUserIsFallback) {
    return { actorId: null, actorEmail: null };
  }

  return { actorId: request.authUser.id, actorEmail: request.authUser.email };
}

function createReaderSessionListItem(
  overview: SessionOverview,
  options: BuildAppOptions,
  viewerId: string
): ReaderSessionListItem {
  const story = options.storyCatalog.findStory(overview.storyId)?.story ?? null;

  return {
    id: overview.id,
    storyId: overview.storyId,
    storyTitle: story?.title ?? overview.storyTitle,
    story,
    readerRoleName: overview.readerRoleName,
    latestSummary: overview.latestNarration ?? "刚刚进入故事。",
    turnCount: overview.turnCount,
    isAuthorTrial: isAuthorTrial(story?.ownerId, viewerId),
    createdAt: overview.createdAt,
    updatedAt: overview.updatedAt
  };
}

/**
 * The story's own author reading it - a trial, not readership. One comparison for the
 * whole server: the shelf insights, the 继续 list and the usage rows all ask this the
 * same way, so one session cannot be a trial on one screen and a reader on the next.
 * A platform story (null owner) has no author to be, so it is never a trial.
 */
function isAuthorTrial(ownerId: string | null | undefined, viewerId: string): boolean {
  return ownerId != null && ownerId === viewerId;
}



/**
 * What each length preset actually asks the model for. Module level because the shelf
 * quotes the same numbers: telling a reader "每段约 800 字" is only honest if it is
 * the figure the prompt really carries.
 */
const SEGMENT_LENGTH_GUIDES: Record<SegmentLengthPreset, { targetWords: number; paragraphs: number }> = {
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

function createLengthGuide(storyDetail: StoryDetail | undefined) {
  const preset = storyDetail?.story.defaultSegmentLength ?? "standard";

  return {
    preset,
    ...SEGMENT_LENGTH_GUIDES[preset]
  };
}


function splitProfileText(value: string): string[] {
  return value
    .split(/[，,。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}
