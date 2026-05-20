import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockNarrativeProvider } from "@instory/ai-orchestrator";
import type { CreateSessionResponse, CreateTurnResponse, StoryDetail, StorySession } from "@instory/shared";
import { buildApp } from "./app.js";
import { StoryCatalog } from "./data/story-catalog.js";
import { SessionStore } from "./db/session-store.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

let app: TestApp;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "instory-api-"));
  app = await buildApp({
    provider: new MockNarrativeProvider(),
    sessionStore: new SessionStore(join(tempDir, "api.sqlite")),
    storyCatalog: new StoryCatalog(),
    logger: false
  });
});

afterEach(async () => {
  await app.close();
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
