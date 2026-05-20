import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { createSessionRequestSchema, createTurnRequestSchema, storySummarySchema } from "@instory/shared";
import { applyStateDelta, createInitialState, createTimelineNode, shouldCreateTimelineNode } from "@instory/story-engine";
import type { CreateSessionResponse, CreateTurnResponse, SessionTurn, StorySession, TimelineNode } from "@instory/shared";
import type { StoryCatalog } from "./data/story-catalog.js";
import type { SessionStore } from "./db/session-store.js";
import type { ModelRuntime } from "./model-runtime.js";

const updateModelConfigSchema = z.object({
  provider: z.enum(["mock", "openai-compatible"]),
  baseUrl: z.string().nullish(),
  model: z.string().nullish(),
  apiKey: z.string().nullish(),
  clearApiKey: z.boolean().optional()
});

const updateStorySummarySchema = storySummarySchema.omit({ id: true });

export interface BuildAppOptions {
  sessionStore: SessionStore;
  storyCatalog: StoryCatalog;
  modelRuntime: ModelRuntime;
  adminToken?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: options.logger ?? true
  });

  await app.register(cors, {
    origin: true
  });

  app.addHook("onClose", async () => {
    // Storage lifecycle is owned by the process or test harness.
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "instory-server",
    storage: "sqlite"
  }));

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/admin")) {
      return;
    }

    if (!options.adminToken) {
      return;
    }

    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${options.adminToken}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
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

  app.get("/api/admin/moderation/events", async () => ({
    events: []
  }));

  app.get("/api/stories", async () => ({
    stories: options.storyCatalog.listStories()
  }));

  app.get("/api/stories/:storyId", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const storyDetail = options.storyCatalog.findStory(storyId);

    if (!storyDetail) {
      return reply.code(404).send({ error: "Story not found" });
    }

    return storyDetail;
  });

  app.post("/api/stories/:storyId/sessions", async (request, reply) => {
    const { storyId } = request.params as { storyId: string };
    const storyDetail = options.storyCatalog.findStory(storyId);

    if (!storyDetail) {
      return reply.code(404).send({ error: "Story not found" });
    }

    const parsed = createSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const requestedCharacter = parsed.data.characterId
      ? options.storyCatalog.findCharacter(parsed.data.characterId)
      : null;
    const character =
      requestedCharacter?.storyId === storyId ? requestedCharacter : storyDetail.characters[0] ?? null;
    const now = new Date().toISOString();
    const sessionId = `sess_${crypto.randomUUID()}`;
    const initialState = createInitialState();

    const session: StorySession = {
      id: sessionId,
      storyId,
      readerRole: {
        mode: parsed.data.entryMode,
        characterId: character?.id,
        name: parsed.data.customRole?.name ?? character?.name ?? "陌生来客",
        description: parsed.data.customRole?.description ?? character?.role ?? "被卷入故事的读者"
      },
      state: initialState,
      turns: [],
      timeline: [],
      createdAt: now,
      updatedAt: now
    };

    const openingTurn: SessionTurn = {
      id: "turn_0",
      sessionId,
      inputType: "free_text",
      input: "进入故事",
      narration: "你醒来时，窗外正落着细雨。陌生的旧宅木梁低垂，空气里有潮湿的檀香味。门外有人停下脚步，像是在确认你的呼吸。",
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
        },
        {
          id: "opening_c2",
          text: "先观察房间里的线索",
          risk: "low"
        }
      ],
      stateSnapshot: initialState,
      createdAt: now
    };

    const openingNode: TimelineNode = {
      id: "node_0",
      sessionId,
      turnId: openingTurn.id,
      title: initialState.scene,
      summary: "你在雨夜旧宅醒来，陆清河提醒你不要出声。",
      stateSnapshot: initialState,
      createdAt: now
    };

    session.turns.push(openingTurn);
    session.timeline.push(openingNode);
    options.sessionStore.save(session);

    const response: CreateSessionResponse = {
      session,
      openingTurn
    };

    return response;
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = options.sessionStore.findById(sessionId);

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return { session };
  });

  app.post("/api/sessions/:sessionId/turns", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = options.sessionStore.findById(sessionId);

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const parsed = createTurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const result = await options.modelRuntime.getProvider().generateNarrative({
      session,
      userInput: parsed.data.content
    });
    const nextState = applyStateDelta(session.state, result.stateDelta);
    const now = new Date().toISOString();
    const turn: SessionTurn = {
      id: `turn_${session.turns.length}`,
      sessionId,
      inputType: parsed.data.inputType,
      input: parsed.data.content,
      narration: result.narration,
      dialogues: result.dialogues,
      choices: result.choices,
      stateSnapshot: nextState,
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
    options.sessionStore.save(session);

    const response: CreateTurnResponse = {
      turn,
      state: nextState,
      timelineNode,
      quota: {
        remainingTurnsToday: Math.max(0, 20 - session.turns.length)
      }
    };

    return response;
  });

  app.post("/api/sessions/:sessionId/rewind", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = options.sessionStore.findById(sessionId);
    const body = request.body as { timelineNodeId?: string };

    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
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

    options.sessionStore.save(branch);

    return {
      session: branch
    };
  });

  return app;
}
