import cors from "@fastify/cors";
import Fastify from "fastify";
import { MockNarrativeProvider } from "@instory/ai-orchestrator";
import { createSessionRequestSchema, createTurnRequestSchema } from "@instory/shared";
import { createTimelineNode, applyStateDelta, createInitialState, shouldCreateTimelineNode } from "@instory/story-engine";
import type {
  CharacterProfile,
  CreateSessionResponse,
  CreateTurnResponse,
  StorySession,
  StorySummary,
  SessionTurn,
  TimelineNode
} from "@instory/shared";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const provider = new MockNarrativeProvider();
const stories: StorySummary[] = [
  {
    id: "rain-mansion",
    title: "雨夜旧宅",
    tagline: "你醒来时，门外的人已经知道了你的名字。",
    genre: "悬疑",
    aiFreedom: "medium"
  }
];

const characters: CharacterProfile[] = [
  {
    id: "lu_qinghe",
    storyId: "rain-mansion",
    name: "陆清河",
    role: "旧宅管事",
    personality: ["克制", "敏锐", "有所隐瞒"],
    goals: ["保护旧宅秘密", "确认你的真实身份"],
    constraints: ["不会主动透露主人死因", "不会无故离开旧宅"]
  }
];

const sessions = new Map<string, StorySession>();

app.get("/api/health", async () => ({
  ok: true,
  service: "instory-server"
}));

app.get("/api/stories", async () => ({
  stories
}));

app.get("/api/stories/:storyId", async (request, reply) => {
  const { storyId } = request.params as { storyId: string };
  const story = stories.find((item) => item.id === storyId);

  if (!story) {
    return reply.code(404).send({ error: "Story not found" });
  }

  return {
    story,
    characters: characters.filter((item) => item.storyId === storyId)
  };
});

app.post("/api/stories/:storyId/sessions", async (request, reply) => {
  const { storyId } = request.params as { storyId: string };
  const story = stories.find((item) => item.id === storyId);

  if (!story) {
    return reply.code(404).send({ error: "Story not found" });
  }

  const parsed = createSessionRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
  }

  const character = parsed.data.characterId ? characters.find((item) => item.id === parsed.data.characterId) : characters[0];
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
  sessions.set(session.id, session);

  const response: CreateSessionResponse = {
    session,
    openingTurn
  };

  return response;
});

app.get("/api/sessions/:sessionId", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const session = sessions.get(sessionId);

  if (!session) {
    return reply.code(404).send({ error: "Session not found" });
  }

  return { session };
});

app.post("/api/sessions/:sessionId/turns", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const session = sessions.get(sessionId);

  if (!session) {
    return reply.code(404).send({ error: "Session not found" });
  }

  const parsed = createTurnRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
  }

  const result = await provider.generateNarrative({
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
  const session = sessions.get(sessionId);
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

  sessions.set(branch.id, branch);

  return {
    session: branch
  };
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });
