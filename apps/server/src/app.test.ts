import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockNarrativeProvider } from "@instory/ai-orchestrator";
import type { CreateSessionResponse, CreateTurnResponse, StoryDetail, StorySession } from "@instory/shared";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { AppDatabase } from "./db/app-database.js";
import { SessionStore } from "./db/session-store.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

let app: TestApp;
let database: AppDatabase;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
  database = new AppDatabase(join(tempDir, "api.sqlite"));
  app = await buildApp({
    provider: new MockNarrativeProvider(),
    sessionStore: new SessionStore(database),
    storyCatalog: new StoryCatalog(database),
    modelConfig: {
      provider: "mock",
      apiKeyConfigured: false
    },
    logger: false
  });
});

afterEach(async () => {
  await app?.close();
  database?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("server API", () => {
  it("returns health and story catalog details", async () => {
    const health = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      ok: true,
      service: "instory-server",
      storage: "sqlite"
    });

    const story = await app.inject({
      method: "GET",
      url: "/api/stories/rain-mansion"
    });
    const body = story.json<StoryDetail>();

    expect(story.statusCode).toBe(200);
    expect(body.story.title).toBe("雨夜旧宅");
    expect(body.world.locations).toHaveLength(3);
    expect(body.characters).toHaveLength(2);
    expect(body.anchors).toHaveLength(4);
  });

  it("creates a session, advances a turn, and reads it back", async () => {
    const created = await createSession();
    const sessionId = created.session.id;

    expect(created.openingTurn.id).toBe("turn_0");
    expect(created.session.timeline).toHaveLength(1);

    const turnResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        inputType: "free_text",
        content: "我查看门缝外的影子。"
      }
    });
    const turnBody = turnResponse.json<CreateTurnResponse>();

    expect(turnResponse.statusCode).toBe(200);
    expect(turnBody.turn.id).toBe("turn_1");
    expect(turnBody.turn.choices).toHaveLength(3);
    expect(turnBody.state.turnCount).toBe(1);
    expect(turnBody.state.clues).toHaveLength(1);

    const loaded = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`
    });
    const loadedBody = loaded.json<{ session: StorySession }>();

    expect(loaded.statusCode).toBe(200);
    expect(loadedBody.session.turns).toHaveLength(2);
    expect(loadedBody.session.state.clues).toEqual(turnBody.state.clues);
  });

  it("creates a rewind branch from a timeline node", async () => {
    const created = await createSession();
    const sessionId = created.session.id;

    const rewind = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/rewind`,
      payload: {
        timelineNodeId: "node_0"
      }
    });
    const body = rewind.json<{ session: StorySession }>();

    expect(rewind.statusCode).toBe(200);
    expect(body.session.id).not.toBe(sessionId);
    expect(body.session.turns).toHaveLength(1);
    expect(body.session.timeline).toHaveLength(1);

    const loadedBranch = await app.inject({
      method: "GET",
      url: `/api/sessions/${body.session.id}`
    });

    expect(loadedBranch.statusCode).toBe(200);
  });

  it("returns clear errors for missing resources and invalid requests", async () => {
    const missingStory = await app.inject({
      method: "GET",
      url: "/api/stories/missing"
    });
    expect(missingStory.statusCode).toBe(404);

    const invalidSession = await app.inject({
      method: "POST",
      url: "/api/stories/rain-mansion/sessions",
      payload: {
        entryMode: "bad_mode"
      }
    });
    expect(invalidSession.statusCode).toBe(400);

    const missingSession = await app.inject({
      method: "GET",
      url: "/api/sessions/missing"
    });
    expect(missingSession.statusCode).toBe(404);
  });

  it("returns admin status, model config, story catalog, sessions and moderation events", async () => {
    const created = await createSession();

    const status = await app.inject({
      method: "GET",
      url: "/api/admin/status"
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      service: "instory-server",
      storage: {
        type: "sqlite"
      },
      counts: {
        stories: 1,
        sessions: 1
      }
    });

    const models = await app.inject({
      method: "GET",
      url: "/api/admin/models"
    });
    expect(models.statusCode).toBe(200);
    expect(models.json()).toEqual({
      provider: "mock",
      baseUrl: null,
      model: null,
      apiKeyConfigured: false
    });

    const stories = await app.inject({
      method: "GET",
      url: "/api/admin/stories"
    });
    expect(stories.statusCode).toBe(200);
    expect(stories.json<{ stories: unknown[] }>().stories).toHaveLength(1);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/admin/sessions"
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json<{ sessions: Array<{ id: string; turnCount: number }> }>().sessions).toContainEqual(
      expect.objectContaining({
        id: created.session.id,
        turnCount: 1
      })
    );

    const sessionDetail = await app.inject({
      method: "GET",
      url: `/api/admin/sessions/${created.session.id}`
    });
    expect(sessionDetail.statusCode).toBe(200);
    expect(sessionDetail.json<{ session: StorySession }>().session.id).toBe(created.session.id);

    const moderation = await app.inject({
      method: "GET",
      url: "/api/admin/moderation/events"
    });
    expect(moderation.statusCode).toBe(200);
    expect(moderation.json()).toEqual({ events: [] });
  });

  it("protects admin routes when an admin token is configured", async () => {
    await app.close();
    database.close();
    rmSync(tempDir, { recursive: true, force: true });

    tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
    database = new AppDatabase(join(tempDir, "api.sqlite"));
    app = await buildApp({
      provider: new MockNarrativeProvider(),
      sessionStore: new SessionStore(database),
      storyCatalog: new StoryCatalog(database),
      modelConfig: {
        provider: "mock",
        apiKeyConfigured: false
      },
      adminToken: "secret",
      logger: false
    });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/admin/status"
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/api/admin/status",
      headers: {
        authorization: "Bearer secret"
      }
    });
    expect(authorized.statusCode).toBe(200);
  });
});

async function createSession(): Promise<CreateSessionResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/api/stories/rain-mansion/sessions",
    payload: {
      entryMode: "existing_character",
      characterId: "lu_qinghe"
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json<CreateSessionResponse>();
}
